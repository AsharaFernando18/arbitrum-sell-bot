const db = require('../lib/database');
const assert = require('assert');

// A unique dummy email to ensure tests don't overlap
const TEST_EMAIL = `testuser_bot_${Date.now()}@example.com`;
const TEST_PASSWORD = 'supersecretpassword123';
let createdUserId = null;

async function runTests() {
  console.log('--- Starting Firebase Tests ---');

  if (!db.isDbInitialized()) {
    console.error('❌ Firebase is not initialized. Make sure the JSON key is present.');
    process.exit(1);
  }

  try {
    // 1. Create User Test
    console.log('\n[1] Testing createUser...');
    const createRes = await db.createUser(TEST_EMAIL, TEST_PASSWORD);
    assert.ok(createRes.success, 'Failed to create user');
    assert.ok(createRes.user.id, 'User ID is missing');
    createdUserId = createRes.user.id;
    console.log('✅ User created successfully with ID:', createdUserId);

    // 2. Duplicate Email Test
    console.log('\n[2] Testing duplicate email creation...');
    const dupRes = await db.createUser(TEST_EMAIL, 'anotherpassword');
    assert.strictEqual(dupRes.success, false, 'Should fail creating a duplicate user');
    console.log('✅ Prevented duplicate user creation');

    // 3. Verify User Test (Correct Password)
    console.log('\n[3] Testing verifyUser with correct password...');
    const verifyRes = await db.verifyUser(TEST_EMAIL, TEST_PASSWORD);
    assert.ok(verifyRes.success, 'Failed to verify correct password');
    console.log('✅ Password verified correctly');

    // 4. Verify User Test (Incorrect Password)
    console.log('\n[4] Testing verifyUser with incorrect password...');
    const badVerifyRes = await db.verifyUser(TEST_EMAIL, 'wrongpassword');
    assert.strictEqual(badVerifyRes.success, false, 'Should fail with incorrect password');
    console.log('✅ Incorrect password rejected');

    // 5. Get User By Email
    console.log('\n[5] Testing getUserByEmail...');
    const fetchedUser = await db.getUserByEmail(TEST_EMAIL);
    assert.ok(fetchedUser, 'Could not fetch user by email');
    assert.strictEqual(fetchedUser.email, TEST_EMAIL, 'Emails do not match');
    console.log('✅ Fetched user by email');

    // 6. Save User Config
    console.log('\n[6] Testing saveUserConfig...');
    const dummyConfig = {
      rpcUrl: 'https://test.rpc',
      tokenAddress: '0x123',
      privateKey: '0xabc123' // Should be encrypted
    };
    const configRes = await db.saveUserConfig(createdUserId, TEST_PASSWORD, dummyConfig);
    assert.ok(configRes.success, 'Failed to save config');
    console.log('✅ Config saved successfully');

    // 7. Get User Config
    console.log('\n[7] Testing getUserConfig...');
    const retrievedConfig = await db.getUserConfig(createdUserId, TEST_PASSWORD);
    assert.ok(retrievedConfig, 'Could not retrieve config');
    assert.strictEqual(retrievedConfig.rpcUrl, 'https://test.rpc', 'Config RPC URL mismatch');
    assert.strictEqual(retrievedConfig.privateKey, '0xabc123', 'Private key decryption failed');
    console.log('✅ Config retrieved and decrypted correctly');

    // 8. Update Bot Status (with undefined value test)
    console.log('\n[8] Testing updateBotStatus with undefined values...');
    const statusRes = await db.updateBotStatus(createdUserId, 'running', {
      last_error: undefined, // Should be sanitized
      test_field: 'works'
    });
    assert.ok(statusRes.success, 'Failed to update bot status');
    console.log('✅ Bot status updated (sanitization works)');

    // 9. Get Bot Status
    console.log('\n[9] Testing getBotStatus...');
    const botStatus = await db.getBotStatus(createdUserId);
    assert.ok(botStatus, 'Failed to get bot status');
    assert.strictEqual(botStatus.bot_status, 'running', 'Bot status mismatch');
    console.log('✅ Bot status retrieved');

  } catch (err) {
    console.error('❌ Test failed with error:', err.message);
    process.exitCode = 1;
  } finally {
    // 10. Delete User Test (Cleanup)
    if (createdUserId) {
      console.log('\n[10] Testing deleteUser and cleaning up...');
      const delRes = await db.deleteUser(createdUserId);
      if (delRes.success) {
        console.log('✅ User and all associated data deleted successfully');
      } else {
        console.error('❌ Failed to clean up test user:', delRes.error);
        process.exitCode = 1;
      }
    }
  }

  console.log('\n--- Tests Finished ---');
  // Exit manually to terminate firebase-admin connection
  process.exit(process.exitCode || 0);
}

runTests();
