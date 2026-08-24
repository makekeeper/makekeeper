import { describe, it, expect } from 'vitest';
import { fieldNumber, fieldValue, isValueCarrying } from './field-value';

// The point of this helper is that the narrowing is REAL: the cast it replaces
// was true right up until somebody moved the handler onto another element, and
// then it was a lie the compiler had agreed to.

const eventFrom = (target: EventTarget | null): Event => {
  const event = new Event('change');
  Object.defineProperty(event, 'target', { value: target });
  return event;
};

describe('fieldValue', () => {
  it('reads an input, a textarea and a select alike', () => {
    const input = document.createElement('input');
    input.value = 'RC0805';
    const textarea = document.createElement('textarea');
    textarea.value = 'two\nlines';
    const select = document.createElement('select');
    const option = document.createElement('option');
    option.value = '0603';
    select.append(option);
    select.value = '0603';

    expect(fieldValue(eventFrom(input))).toBe('RC0805');
    expect(fieldValue(eventFrom(textarea))).toBe('two\nlines');
    expect(fieldValue(eventFrom(select))).toBe('0603');
  });

  it('reads an element that carries no value as empty, not as a crash', () => {
    expect(fieldValue(eventFrom(document.createElement('div')))).toBe('');
    expect(fieldValue(eventFrom(null))).toBe('');
  });
});

describe('fieldNumber', () => {
  it('parses what the field holds', () => {
    const input = document.createElement('input');
    input.value = '12';
    expect(fieldNumber(eventFrom(input))).toBe(12);
  });

  it('says NaN for an emptied field rather than zero', () => {
    // `Number('')` is 0, which would read as a real quantity of nothing.
    const input = document.createElement('input');
    input.value = '  ';
    expect(fieldNumber(eventFrom(input))).toBeNaN();
  });
});

describe('isValueCarrying', () => {
  it('is the guard both readers share', () => {
    expect(isValueCarrying(document.createElement('input'))).toBe(true);
    expect(isValueCarrying(document.createElement('div'))).toBe(false);
    expect(isValueCarrying(null)).toBe(false);
  });
});
