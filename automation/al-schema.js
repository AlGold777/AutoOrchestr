// Automation Lab — CSP-safe JSON Schema interpreter (draft-07 subset used by the v2.2.x bundle).
// No eval/new Function, so it runs in MV3 extension pages. Unknown annotation keywords
// (description, title, $id, x-*) are ignored, which keeps custom metadata from breaking validation.
(function initAlSchema(root) {
  'use strict';

  const jcs = (value) => (root.AlCanonical || require('./al-canonical.js')).jcs(value);
  const patternCache = new Map();
  const toRegExp = (pattern) => {
    if (!patternCache.has(pattern)) patternCache.set(pattern, new RegExp(pattern, 'u'));
    return patternCache.get(pattern);
  };

  const typeOf = (value) => {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    return typeof value;
  };
  const matchesType = (value, type) => {
    const actual = typeOf(value);
    if (type === 'number') return actual === 'number' || actual === 'integer';
    return actual === type;
  };
  const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

  function validate(schema, value, path = '$', errors = []) {
    if (schema === true || schema == null) return errors;
    if (schema === false) {
      errors.push({ path, keyword: 'false', message: 'value is not allowed' });
      return errors;
    }
    const push = (keyword, message) => errors.push({ path, keyword, message });

    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((type) => matchesType(value, type))) {
        push('type', `expected ${types.join('|')}, got ${typeOf(value)}`);
        return errors;
      }
    }
    if (schema.const !== undefined && jcs(schema.const) !== jcs(value)) push('const', `must equal ${JSON.stringify(schema.const)}`);
    if (Array.isArray(schema.enum) && !schema.enum.some((item) => jcs(item) === jcs(value))) {
      push('enum', `must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
    }

    if (typeof value === 'string') {
      if (schema.minLength !== undefined && [...value].length < schema.minLength) push('minLength', `shorter than ${schema.minLength}`);
      if (schema.maxLength !== undefined && [...value].length > schema.maxLength) push('maxLength', `longer than ${schema.maxLength}`);
      if (schema.pattern !== undefined && !toRegExp(schema.pattern).test(value)) push('pattern', `does not match ${schema.pattern}`);
      if (schema.format === 'date-time' && !DATE_TIME.test(value)) push('format', 'not an RFC 3339 date-time');
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) push('minimum', `less than ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) push('maximum', `greater than ${schema.maximum}`);
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) push('minItems', `fewer than ${schema.minItems} items`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) push('maxItems', `more than ${schema.maxItems} items`);
      if (schema.uniqueItems) {
        const seen = new Set();
        value.forEach((item) => {
          const key = jcs(item);
          if (seen.has(key)) push('uniqueItems', 'duplicate items');
          seen.add(key);
        });
      }
      if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
        value.forEach((item, index) => validate(schema.items, item, `${path}[${index}]`, errors));
      }
    }
    if (typeOf(value) === 'object') {
      const keys = Object.keys(value);
      if (schema.minProperties !== undefined && keys.length < schema.minProperties) push('minProperties', `fewer than ${schema.minProperties} properties`);
      (schema.required || []).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          errors.push({ path: `${path}.${key}`, keyword: 'required', message: 'is required' });
        }
      });
      const properties = schema.properties || {};
      keys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(properties, key)) {
          validate(properties[key], value[key], `${path}.${key}`, errors);
        } else if (schema.additionalProperties === false) {
          errors.push({ path: `${path}.${key}`, keyword: 'additionalProperties', message: 'unknown property' });
        } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          validate(schema.additionalProperties, value[key], `${path}.${key}`, errors);
        }
      });
    }

    const passes = (sub) => validate(sub, value, path, []).length === 0;
    if (Array.isArray(schema.allOf)) schema.allOf.forEach((sub) => validate(sub, value, path, errors));
    if (Array.isArray(schema.anyOf) && !schema.anyOf.some(passes)) push('anyOf', 'matches no allowed alternative');
    if (Array.isArray(schema.oneOf)) {
      const count = schema.oneOf.filter(passes).length;
      if (count !== 1) push('oneOf', `must match exactly one alternative (matched ${count})`);
    }
    if (schema.not !== undefined && passes(schema.not)) push('not', 'matches a forbidden shape');
    if (schema.if !== undefined) {
      if (passes(schema.if)) {
        if (schema.then !== undefined) validate(schema.then, value, path, errors);
      } else if (schema.else !== undefined) {
        validate(schema.else, value, path, errors);
      }
    }
    return errors;
  }

  const formatErrors = (errors, limit = 12) => errors.slice(0, limit)
    .map((error) => `${error.path}: ${error.message}`)
    .concat(errors.length > limit ? [`… ${errors.length - limit} more`] : []);

  const api = Object.freeze({ validate, formatErrors, typeOf });
  root.AlSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
