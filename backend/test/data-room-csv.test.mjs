import { describe, it, expect } from 'vitest';
import { BOM, csvField, csvLine, rowsToCsv } from '../src/lib/data-room/csv.js';

describe('csvField', () => {
  it('passes plain strings through untouched', () => {
    expect(csvField('Ashford')).toBe('Ashford');
  });
  it('quotes and doubles quotes when the value has a comma, quote or newline', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField('line1\r\nline2')).toBe('"line1\r\nline2"');
  });
  it('null/undefined become an empty field', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });
  it('numbers and booleans stringify without quoting', () => {
    expect(csvField(12345)).toBe('12345');
    expect(csvField(true)).toBe('true');
    expect(csvField(false)).toBe('false');
  });
  it('objects/arrays become quoted JSON text', () => {
    expect(csvField({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvField([1, 2])).toBe('"[1,2]"');
  });
  it('Date instances become ISO strings', () => {
    expect(csvField(new Date('2026-08-25T10:00:00Z'))).toBe('2026-08-25T10:00:00.000Z');
  });
});

describe('csvLine / rowsToCsv', () => {
  it('joins with commas and terminates with CRLF', () => {
    expect(csvLine(['a', 1, null])).toBe('a,1,\r\n');
  });
  it('emits rows in column order, missing keys as empty', () => {
    const out = rowsToCsv(['id', 'amount_pence'], [{ id: 'x', amount_pence: 100 }, { id: 'y' }]);
    expect(out).toBe('x,100\r\ny,\r\n');
  });
  it('BOM is the UTF-8 byte order mark', () => {
    expect(BOM).toBe('﻿');
  });
});
