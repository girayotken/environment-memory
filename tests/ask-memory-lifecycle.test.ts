import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AskMemoryLifecycle} from '../src/client/ask-memory-lifecycle.ts';

test('changing a query or cancelling invalidates and aborts the pending answer',()=>{const lifecycle=new AskMemoryLifecycle();const first=lifecycle.begin();assert.equal(first.isCurrent(),true);lifecycle.invalidate();assert.equal(first.signal.aborted,true);assert.equal(first.isCurrent(),false);const second=lifecycle.begin();assert.equal(second.isCurrent(),true);lifecycle.invalidate();assert.equal(second.isCurrent(),false);});
test('new requests and unmount cannot accept stale answers',()=>{const lifecycle=new AskMemoryLifecycle();const first=lifecycle.begin(),second=lifecycle.begin();assert.equal(first.isCurrent(),false);assert.equal(second.isCurrent(),true);lifecycle.invalidate();assert.equal(second.signal.aborted,true);assert.equal(second.isCurrent(),false);});
