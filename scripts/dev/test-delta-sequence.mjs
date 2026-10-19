import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {restoreReviewedSequenceState} from '../neon/delta-sequence.mjs';
const db=new PGlite();try{
 await db.exec('CREATE SEQUENCE public.test_delta_seq; SELECT nextval(\'public.test_delta_seq\');');
 const state=()=>db.query('SELECT last_value::text value,is_called FROM public.test_delta_seq');
 const baseline=(await state()).rows;
 await db.query('BEGIN');await restoreReviewedSequenceState(db,{schema:'public',name:'test_delta_seq',state:{lastValue:'52',isCalled:true}});await db.query('ROLLBACK');assert.deepEqual((await state()).rows,baseline,'Rollback restores restarted sequence after nextval');
 await db.query('BEGIN');await restoreReviewedSequenceState(db,{schema:'public',name:'test_delta_seq',state:{lastValue:'52',isCalled:true}});await db.query('COMMIT');assert.equal((await db.query("SELECT nextval('public.test_delta_seq')::text value")).rows[0].value,'53');
 await db.query('BEGIN');await restoreReviewedSequenceState(db,{schema:'public',name:'test_delta_seq',state:{lastValue:'100',isCalled:false}});await db.query('COMMIT');assert.equal((await db.query("SELECT nextval('public.test_delta_seq')::text value")).rows[0].value,'100');
 console.log('PASS transactional identity sequence restart: exact called/uncalled state, next key, rollback after nextval; no setval');
}finally{await db.close();}
