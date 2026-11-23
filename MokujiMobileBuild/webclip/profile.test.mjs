import assert from 'node:assert/strict';
import { createWebClipProfile, WEBCLIP_PATH, webClipHeaders } from './webclip-profile.mjs';
assert.equal(WEBCLIP_PATH,'/install/Mokuji.mobileconfig');
assert.equal(webClipHeaders['Content-Type'],'application/x-apple-aspen-config');
for (const origin of ['http://10.3.4.5:5199','http://172.16.2.174:5199','http://172.31.0.1','http://192.168.1.22','https://reader.example.com']) {
  const xml=createWebClipProfile(origin);
  assert.ok(xml.includes(origin+'/#/webfiction'));
}
for(const origin of ['file:///a','https://reader.example.com/?token=guest','https://reader.example.com/#/secret','https://u:p@site.org/','http://172.32.1.2','http://8.8.8.8','http://127.0.0.1:5199','https://localhost/','http://192.168.12.7/redirect','https://site.org\\admin','https://site.org\n','javascript:alert(1)']) assert.throws(()=>createWebClipProfile(origin),origin);
console.log('Verified profile destinations, HTTP response metadata and rejected unsuitable inputs');
