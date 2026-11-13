import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyMessages } from '../src/insights.js';

test('reads a forecast discussion’s key messages as single lines', () => {
  const text = `FXUS65 KPUB 132022\n\n.KEY MESSAGES...\n\n- First system to affect the region tonight, bringing snow to the\n  mountains and showers to the plains.\n\n- Another mountain snow event late Tuesday into Wednesday.\n\n&&\n\n.SHORT TERM /THROUGH SATURDAY NIGHT/...\nblah`;
  assert.deepEqual(keyMessages(text), [
    'First system to affect the region tonight, bringing snow to the mountains and showers to the plains.',
    'Another mountain snow event late Tuesday into Wednesday.',
  ]);
  assert.deepEqual(keyMessages('no such section'), []);
});
