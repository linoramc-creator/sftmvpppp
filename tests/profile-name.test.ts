import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProfileName, profileDisplayName} from '../supabase/functions/analyze-ticker/profile-name.ts';

test('account greetings use validated human names without changing identity or authority',()=>{
  assert.equal(profileDisplayName({display_name:'  María   O’Neill ',full_name:'Other Name',isAdmin:true},'person@example.test'),'María O’Neill');
  assert.equal(profileDisplayName({full_name:'François D’Arcy'},'person@example.test'),'François D’Arcy');
  assert.equal(normalizeProfileName('李 明'),'李 明');
});
test('unsafe or malformed metadata cannot enter a greeting',()=>{
  for(const value of ['<img src=x onerror=alert(1)>','<script>alert(1)</script>','Admin\u202E','A\u0000B','A'.repeat(61),{},12,null]) {
    assert.equal(normalizeProfileName(value),'');
    assert.equal(profileDisplayName({display_name:value},'existing.user@example.test'),'existing user');
  }
});
test('older accounts keep a recognizable sanitized alias and never gain a fabricated name',()=>{
  assert.equal(profileDisplayName({},'linoramc@gmail.com'),'linoramc');
  assert.equal(profileDisplayName(null,'asset.user+test@example.test'),'asset user test');
  assert.equal(profileDisplayName({},'123456@example.test'),'');
  assert.equal(profileDisplayName({display_name:'<unsafe>',full_name:'Existing Name'},'user@example.test'),'Existing Name');
});
