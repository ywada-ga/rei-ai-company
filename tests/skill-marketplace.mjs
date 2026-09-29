import assert from 'node:assert/strict';
import { normalizeSkillResults, searchMarketplaceSkills } from '../skill-marketplace.mjs';

const results=normalizeSkillResults({results:[{
  displayName:'LPレビュー', ownerHandle:'publisher', summary:'公開前の確認',
  install:{reference:'publisher/lp-review'}, trust:{installability:'safe'},
  canonicalUrl:'/publisher/skills/lp-review'
}]});
assert.equal(results.length,1);
assert.equal(results[0].name,'LPレビュー');
assert.equal(results[0].url,'https://clawhub.ai/publisher/skills/lp-review');
assert.equal(normalizeSkillResults({results:[{displayName:'危険',install:{reference:'bad'},canonicalUrl:'//evil.example'}]})[0].url,null);
assert.throws(()=>normalizeSkillResults({}),/応答/);
await assert.rejects(searchMarketplaceSkills(''),/検索語/);
console.log('PASS marketplace results are bounded and links are validated');
