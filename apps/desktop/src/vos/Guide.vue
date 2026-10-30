<script setup lang="ts">
import {computed,ref} from 'vue';
import {marked} from 'marked';
import guideZh from './pgv-guide.zh.md?raw';
import guideEn from './pgv-guide.en.md?raw';
import manualZh from '../../../../ictrek.app/src/README.zh-CN.md?raw';
import manualEn from '../../../../ictrek.app/src/README.en.md?raw';
import imageNotes from '../../../../pgv/README.md?raw';
import migration from '../../../../pgv/PG17-MIGRATION.md?raw';
import deployment from '../../../../VOS.md?raw';
import config from '../../../../ictrek.app/src/configs.yml?raw';
import {syncVosState} from './bridge';
const logo=import.meta.env.BASE_URL+'pgv-logo.svg';
const zh=ref(true),selected=ref('guide');
void syncVosState(state=>{if(state.locale)zh.value=state.locale.toLowerCase().startsWith('zh');if(state.theme)document.documentElement.classList.toggle('dark',state.theme==='dark');});
const documents=computed(()=>[
{id:'guide',title:zh.value?'接入与建库':'Connect & create databases',content:zh.value?guideZh:guideEn},
{id:'manual',title:zh.value?'完整用户说明':'Complete user manual',content:zh.value?manualZh:manualEn},
{id:'images',title:zh.value?'镜像构建与发布':'Images & releases',content:imageNotes},
{id:'migration',title:'PG16 → PG17',content:migration},
{id:'deployment',title:zh.value?'VOS 部署与回退':'VOS deployment & rollback',content:deployment},
{id:'config',title:zh.value?'完整安装配置':'Complete install configuration',content:'```yaml\n'+config+'\n```'}]);
// Only bundled repository documents are rendered; no remote or user-supplied HTML.
const content=computed(()=>marked.parse(documents.value.find(d=>d.id===selected.value)?.content||'',{async:false}));
const page=ref<HTMLElement>();
function select(id:string){selected.value=id;page.value?.scrollTo({top:0});}
async function copy(event:MouseEvent){const button=(event.target as HTMLElement).closest('button[data-copy]');if(button){await navigator.clipboard.writeText(button.parentElement?.querySelector('code')?.textContent||'');button.textContent=zh.value?'已复制':'Copied';}}
const html=computed(()=>content.value.replace(/<pre>/g,`<div class="pgv-code"><button data-copy>${zh.value?'复制':'Copy'}</button><pre>`).replace(/<\/pre>/g,'</pre></div>'));
</script>
<template>
<main ref="page" class="pgv-guide">
<header><img :src="logo" alt="PGV" width="48" height="48"><div><h1>PGV · {{zh?'接入指南':'Integration Guide'}}</h1><p>PostgreSQL 17 · Redis · VOS</p></div><a href="/#/app/app-drawer/com.ictrek.pgv/pgv" target="_top">{{zh?'数据库连接器':'Database Connector'}}</a></header>
<div class="pgv-guide-layout"><nav :aria-label="zh?'指南文档':'Guide documents'"><button v-for="doc in documents" :key="doc.id" :aria-current="selected===doc.id?'page':undefined" @click="select(doc.id)">{{doc.title}}</button></nav><article @click="copy" v-html="html" /></div>
</main>
</template>
<style>
.pgv-guide{height:100vh;overflow:auto;background:var(--background,#f8fafc);color:var(--foreground,#172033);font:14px/1.8 system-ui}.pgv-guide header{display:flex;gap:16px;align-items:center;padding:24px max(24px,calc((100vw - 1180px)/2));border-bottom:1px solid #94a3b844}.pgv-guide h1{font-size:23px;font-weight:650}.pgv-guide header p{color:#64748b}.pgv-guide header a{margin-left:auto;color:#2563eb;white-space:nowrap}.pgv-guide-layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:36px;max-width:1180px;margin:auto;padding:28px 24px}.pgv-guide nav{display:flex;flex-direction:column;gap:8px;align-self:start;position:sticky;top:24px}.pgv-guide nav button{text-align:left;padding:10px 12px;border-radius:8px;cursor:pointer}.pgv-guide nav button[aria-current]{background:#dbeafe;color:#1d4ed8}.pgv-guide article{min-width:0;overflow-wrap:anywhere}.pgv-guide article h1{margin:0 0 20px}.pgv-guide article h2{font-size:20px;font-weight:650;margin:30px 0 14px}.pgv-guide article h3{font-size:16px;font-weight:650;margin:22px 0 10px}.pgv-guide article p,.pgv-guide article ul,.pgv-guide article ol{margin:12px 0}.pgv-guide article ul{list-style:disc;padding-left:24px}.pgv-guide article ol{list-style:decimal;padding-left:24px}.pgv-guide table{display:block;overflow-x:auto;border-collapse:collapse;margin:18px 0;font-size:13px}.pgv-guide th,.pgv-guide td{border:1px solid #94a3b855;padding:8px 12px;text-align:left}.pgv-guide th{background:#94a3b818}.pgv-code{position:relative;margin:16px 0}.pgv-code pre{background:#94a3b815;border:1px solid #94a3b844;border-radius:10px;padding:38px 16px 16px;overflow:auto;line-height:1.7;font-size:12px}.pgv-code button{position:absolute;right:8px;top:6px;padding:2px 8px;border:1px solid #94a3b855;border-radius:5px;cursor:pointer}.pgv-guide a{color:#3b82f6}@media(max-width:760px){.pgv-guide-layout{grid-template-columns:1fr}.pgv-guide nav{position:static;flex-direction:row;flex-wrap:wrap}.pgv-guide header{padding:18px}.pgv-guide h1{font-size:18px}}
</style>
