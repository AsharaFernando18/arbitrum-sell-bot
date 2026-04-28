import re

with open("bot.js", "r") as f:
    content = f.read()

# 1. Replace imports and setup
content = re.sub(
    r'const stateStore = require\("\./lib/state-store"\);\n\nconst USER_ID = process\.env\.USER_ID;\n\nconst getStateFunctions = \(\) => \{.*?\};\n\nconst \{ readBotState, writeBotState, appendHistory \} = getStateFunctions\(\);\n',
    'const db = require("./lib/database");\n\nconst USER_ID = process.env.USER_ID;\n',
    content,
    flags=re.DOTALL
)

# 2. Update mergeState
old_merge_state = """function mergeState(patch) {
  const prev = readBotState() || {};
  const next = { ...prev, ...patch, version: 1 };
  writeBotState(next);
  return next;
}"""

new_merge_state = """async function mergeState(patch) {
  const prev = (await db.getBotState(USER_ID)) || {};
  const next = { ...prev, ...patch, version: 1 };
  await db.saveBotState(USER_ID, next);
  return next;
}"""

content = content.replace(old_merge_state, new_merge_state)

# 3. Add await to mergeState
content = re.sub(r'(\s+)mergeState\(', r'\1await mergeState(', content)

# 4. Add await to readBotState
content = re.sub(r'readBotState\(\)', r'db.getBotState(USER_ID)', content)
# Ensure it is awaited
content = re.sub(r'(\s+let st = )db.getBotState\(USER_ID\)', r'\1await db.getBotState(USER_ID)', content)
content = re.sub(r'(\s+st = )db.getBotState\(USER_ID\)', r'\1await db.getBotState(USER_ID)', content)


# 5. Add await to appendHistory
content = re.sub(r'(\s+)appendHistory\(', r'\1await db.appendHistory(USER_ID, ', content)

# 6. Make scheduleTodaySell async
content = content.replace("function scheduleTodaySell() {", "async function scheduleTodaySell() {")

with open("bot.js", "w") as f:
    f.write(content)
