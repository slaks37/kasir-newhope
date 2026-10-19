import assert from 'node:assert/strict';
import {relation} from './backup-common.mjs';
// ALTER ... RESTART is transactional (unlike setval). Consume the restarted
// value only when the source was called, preserving exact last_value/is_called.
export async function restoreReviewedSequenceState(client,sequence){
 const value=sequence.state.lastValue;assert(/^-?\d+$/.test(value),'SEQUENCE_VALUE_INVALID');
 await client.query('ALTER SEQUENCE '+relation(sequence)+' RESTART WITH '+BigInt(value).toString());
 if(sequence.state.isCalled){const r=await client.query('SELECT nextval($1::regclass)::text value',[relation(sequence)]);assert.equal(r.rows[0].value,value,'SEQUENCE_RESTART_VALUE_MISMATCH');}
 const actual=(await client.query('SELECT last_value::text value,is_called FROM '+relation(sequence))).rows[0];
 assert.equal(actual.value,value);assert.equal(actual.is_called,sequence.state.isCalled);
}
