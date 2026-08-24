import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectPrinters,
  entitiesOf,
  printerOfMapping,
  suggestMapping,
} from './ha-discovery.ts';

// Run with: npm test (node --test, no dependencies).
//
// This is the part of the plugin that guesses, so it is the part that needs
// evidence. A wrong guess is not a crash: it produces a settings screen that
// looks configured and a printer that reads `unavailable` forever.

// A believable slice of a real install: one printer with the current naming,
// one with an older one, and the household noise a `_status` suffix attracts.
const ENTITIES = [
  'sensor.p1s_print_status',
  'sensor.p1s_print_progress',
  'sensor.p1s_remaining_time',
  'sensor.p1s_nozzle_temperature',
  'sensor.p1s_bed_temperature',
  'sensor.p1s_task_name',
  'sensor.p1s_chamber_temperature',
  'binary_sensor.p1s_hms_errors',
  'sensor.x1c_current_stage',
  'sensor.x1c_progress',
  'sensor.x1c_nozzle_temp',
  'sensor.x1c_print_name',
  'sensor.washing_machine_status',
  'sensor.dishwasher_status',
  'light.kitchen',
  'sensor.outdoor_temperature',
];

test('finds the printers and nothing else', () => {
  assert.deepEqual(detectPrinters(ENTITIES), ['sensor.p1s', 'sensor.x1c']);
});

test('does not offer the near-miss prefixes suffix-cutting produces', () => {
  // `sensor.p1s_print_status` also yields `sensor.p1s_print` when `_status` is
  // cut; the shorter prefix owns strictly more entities, so it wins.
  const printers = detectPrinters(ENTITIES);
  assert.ok(!printers.includes('sensor.p1s_print'));
  assert.ok(!printers.includes('sensor.x1c_current'));
});

test('maps the current naming', () => {
  assert.deepEqual(suggestMapping(ENTITIES, 'sensor.p1s'), {
    haEntityState: 'sensor.p1s_print_status',
    haEntityProgress: 'sensor.p1s_print_progress',
    haEntityRemaining: 'sensor.p1s_remaining_time',
    haEntityNozzle: 'sensor.p1s_nozzle_temperature',
    haEntityBed: 'sensor.p1s_bed_temperature',
    haEntityJob: 'sensor.p1s_task_name',
  });
});

test('maps an older naming, leaving what is absent empty', () => {
  const map = suggestMapping(ENTITIES, 'sensor.x1c');
  assert.equal(map.haEntityState, 'sensor.x1c_current_stage');
  assert.equal(map.haEntityNozzle, 'sensor.x1c_nozzle_temp');
  assert.equal(map.haEntityJob, 'sensor.x1c_print_name');
  // No bed entity in this set: an empty field reads as "not available", a
  // guessed one reads as a broken printer.
  assert.equal(map.haEntityBed, '');
});

test('offers only the chosen printer’s entities', () => {
  const own = entitiesOf(ENTITIES, 'sensor.p1s');
  assert.ok(own.includes('sensor.p1s_chamber_temperature'));
  assert.ok(!own.some((id) => id.includes('x1c')));
});

test('recovers the printer from a stored mapping', () => {
  assert.equal(printerOfMapping('sensor.p1s_print_status'), 'sensor.p1s');
  assert.equal(printerOfMapping('sensor.x1c_current_stage'), 'sensor.x1c');
  // A hand-typed id that matches no known suffix simply names no printer.
  assert.equal(printerOfMapping('sensor.something_else'), '');
});
