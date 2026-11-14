import test from 'node:test';
import assert from 'node:assert/strict';
import {careCommand} from '../public/care-commands.js';
import {previewCarePosition} from '../public/care-chat-position.js';
import {CARE_TEMPLATES,makeCareTemplate} from '../public/care-templates.js';

test('precise Cantonese and Mandarin commands resolve named rooms and units',()=>{
 const plan=makeCareTemplate(CARE_TEMPLATES[1]);
 const command=careCommand('請把主人房的床往左移 20 公分',plan);
 assert.equal(command.type,'position');
 assert.equal(command.roomId,'manual-2');
 assert.equal(command.dx,-.2);
 assert.equal(careCommand('客厅的沙发逆时针旋转90度',plan).turn,-90);
 assert.equal(careCommand('扶手椅向上移 50 mm',plan).dz,-.05);
 assert.match(careCommand('睡房的床向左移10毫米',plan).error,/房間名稱/);
 assert.match(careCommand('床向前移20公分',plan).error,/平面圖/);
 assert.equal(careCommand('請問床向左移20公分可以嗎？',plan),null);
});

test('a legal preview preserves identity and exact dimensions, while locked and off-plan moves fail',()=>{
 const state=makeCareTemplate(CARE_TEMPLATES[0]);
 const project=state.wholeHome.projects.bedroom;
 const command=careCommand('睡房張床向下移 2 公分',state);
 const before=structuredClone(project);
 const preview=previewCarePosition(project,command);
 assert.deepEqual(project,before);
 assert.equal(preview.item.id,project.items[0].id);
 assert.equal(preview.item.w,project.items[0].w);
 assert.ok(Math.abs(preview.item.z-project.items[0].z-.02)<1e-8);
 assert.throws(()=>previewCarePosition(project,{...command,dz:-3}),/超出/);
 project.items[0].locked=true;
 assert.throws(()=>previewCarePosition(project,command),/只.*移動/);
});
