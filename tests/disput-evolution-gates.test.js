const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('Repository gates', () => {
  test('production HTML does not load removed execution switches or executors', () => {
    const removedLoaderPattern = new RegExp(`${'disput-evolution-flags'}|${'free-' + 'talk'}-(runner|runtime|protocol)`);
    for (const file of ['pipeline_panel.html', 'result_new.html']) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(source).not.toMatch(removedLoaderPattern);
    }
  });
});
