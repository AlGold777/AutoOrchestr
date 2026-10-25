const Presets = require('../disput/pipeline-presets');
const BasicSchema = require('../disput/basic-schema');

describe('built-in schema user_doc (seeded on the first start)', () => {
  const schema = Presets.BUILTIN_SCHEMAS.user_doc;

  test('the schema passes BasicSchema.validate without errors', () => {
    expect(BasicSchema.validate(schema)).toEqual([]);
  });

  test('DeepSeek drafts a form in round r1 (json, output.document form)', () => {
    const round = schema.steps.find((step) => step.ref === 'r1');
    expect(round.kind).toBe('round');
    expect(round.models.map((model) => model.name)).toEqual(['DeepSeek']);
    expect(round.output).toMatchObject({ format: 'json', document: 'form' });
  });

  test('User fills the document of r1 in the owner:fill step', () => {
    const fill = schema.steps.find((step) => step.ref === 'owner:fill');
    expect(fill).toMatchObject({ kind: 'owner', document: 'r1' });
  });

  test('the built-in pipeline definitions stay Default only; the schema is not a definition', () => {
    expect(Presets.BUILTIN_PIPELINE_DEFINITIONS.map((item) => item.name)).toEqual(['Default']);
    expect(Presets.PIPELINE_PRESETS.map((preset) => preset.id)).toEqual(['CUSTOM']);
  });
});
