import test from 'node:test';
import assert from 'node:assert/strict';
import {csvCell,toCsv} from '../src/utils/csv.ts';

test('CSV cells quote delimiters, quotes and line breaks',()=>{
 assert.equal(csvCell('Pump, "A"\nNorth'),'"Pump, ""A""\nNorth"');
});
test('CSV neutralizes spreadsheet formula prefixes',()=>{
 for(const value of ['=1+1','+SUM(A1:A2)','-cmd','@SUM(A1)'])assert.ok(csvCell(value).startsWith('"\''));
});
test('CSV preserves safe values and emits CRLF records',()=>{
 assert.equal(toCsv(['name','count'],[['Valve',3]]),'"name","count"\r\n"Valve","3"\r\n');
});
test('CSV represents nullish values as empty cells',()=>assert.equal(csvCell(null),'""'));
