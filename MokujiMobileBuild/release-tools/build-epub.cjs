const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const {pathToFileURL}=require('node:url');

async function build(){
  const root=path.resolve(__dirname,'../..'), cotex=path.join(root,'Cotex');
  const server=path.join(__dirname,'../server');
  const deps=process.env.MOKUJI_EPUB_BUILD_DEPS || path.join(cotex,'node_modules');
  const requireBuild=createRequire(path.join(deps,'../package.json'));
  const {rolldown}=await import(pathToFileURL(requireBuild.resolve('rolldown')).href);
  const bundle=await rolldown({
    input:'cotex-epub-deps',
    platform:'node',
    plugins:[{
      name:'epub-dependency-entry',
      resolveId(id){if(id==='cotex-epub-deps')return '\0'+id;},
      load(id){if(id==='\0cotex-epub-deps')return [
        "export { load } from "+JSON.stringify(path.join(deps,'cheerio/dist/browser/index.js'))+";",
        "export { default as JSZip } from "+JSON.stringify(path.join(deps,'jszip/dist/jszip.min.js'))+";",
        "export { XMLParser } from "+JSON.stringify(path.join(deps,'fast-xml-parser/lib/fxp.cjs'))+";"
      ].join('\n');}
    }]
  });
  const output=await bundle.generate({format:'cjs',minify:true});
  await bundle.close();
  const code=output.output.find(file=>file.type==='chunk');
  const packages=new Set(['jszip','pako','lie','immediate','setimmediate','fast-xml-parser','strnum','fast-xml-builder','@nodable/entities','xml-naming','path-expression-matcher','anynum','fast-xml-parser']);
  for(const id of Object.keys(code.modules)) {
    const match=id.replaceAll('\\','/').split('/node_modules/').at(-1);
    if(!match || match.startsWith('\0'))continue;
    const names=match.split('/');
    if(names.length>1)packages.add(names[0].startsWith('@')?names.slice(0,2).join('/'):names[0]);
  }
  const notices=[];
  for(const name of [...packages].sort()) {
    const dir=path.join(deps,name);
    if(!fs.existsSync(dir))continue;
    const license=fs.readdirSync(dir).find(file=>/^licen[sc]e(?:[.-].*)?$/i.test(file));
    if(license)notices.push(name+'\n'+fs.readFileSync(path.join(dir,license),'utf8'));
  }
  const license=fs.readFileSync(path.join(cotex,'LICENSE'),'utf8');
  fs.writeFileSync(path.join(server,'epub-deps.cjs'),'/*! Third-party notices\n'+notices.join('\n\n').replaceAll('*/','* /')+'\n*/\n'+code.code);
  // Copy the original parser, leaving out unrelated desktop features and the
  // conversion dictionaries. The function boundaries keep updates reviewable.
  const core=fs.readFileSync(path.join(cotex,'electron/core.cjs'),'utf8').replace(/\r\n/g,'\n');
  const images=fs.readFileSync(path.join(cotex,'electron/epub-images.cjs'),'utf8').replace(/\r\n/g,'\n');
  const between=(text,a,b)=>{
    const start=text.indexOf(a),end=text.indexOf(b,start);
    if(start<0 || end<0)throw new Error('Cotex parser layout changed: '+a);
    return text.slice(start,end).trim();
  };
  const parts=[
    '/*! Adapted from Cotex.\n'+license+'*/',
    "const path=require('node:path'), crypto=require('node:crypto');",
    "const {load,JSZip,XMLParser}=require('./epub-deps.cjs');",
    "const cheerio={load};",
    between(core,'const MAX_BYTES','const aliases'),
    between(core,'function safeText','function decodeText'),
    between(core,'function cleanText','function stripGutenberg'),
    between(core,'function paragraphs','function parseTXT'),
    between(images,'function resolveEntry','function validMedia'),
    between(core,'const array=','function finalizeBook'),
    'module.exports={parseEPUB,imageData};'
  ];
  fs.writeFileSync(path.join(server,'epub-reader.cjs'),parts.join('\n\n')+'\n');
}
build().catch(error=>{console.error(error);process.exitCode=1;});
