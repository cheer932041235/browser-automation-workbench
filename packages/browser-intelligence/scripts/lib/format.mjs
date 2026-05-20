function printTitle(title) {
  console.log(`\n${title}`);
  console.log('='.repeat(title.length));
}

function printSection(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

function printKeyValue(label, value) {
  console.log(`${label.padEnd(18)} ${value}`);
}

function printList(items) {
  for (const item of items) console.log(`- ${item}`);
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function formatStatus(ok) {
  return ok ? 'OK' : 'MISSING';
}

export {
  printTitle,
  printSection,
  printKeyValue,
  printList,
  printJson,
  formatStatus,
};
