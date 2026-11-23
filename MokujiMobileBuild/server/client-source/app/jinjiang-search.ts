// Jinjiang's public search form submits GB18030, even when browsers display UTF-8 elsewhere.
const decoder=new TextDecoder('gb18030');
let twoByteCodes:Map<string,number>|undefined;

function twoByteTable() {
  if (twoByteCodes) return twoByteCodes;
  const count=126*190;
  const bytes=new Uint8Array(count*3);
  for (let index=0;index<count;index++) {
    bytes[index*3]=0x81+Math.floor(index/190);
    const trail=index%190;
    bytes[index*3+1]=trail+(trail<63?0x40:0x41);
    // A NUL separator lets the decoder return one string per byte pair in a single pass.
  }
  const chars=decoder.decode(bytes).split('\0');
  twoByteCodes=new Map();
  for (let index=0;index<count;index++) {
    const char=chars[index];
    if(char.length===1 && char!=='\uFFFD' && !twoByteCodes.has(char))
      twoByteCodes.set(char,bytes[index*3]*256+bytes[index*3+1]);
  }
  return twoByteCodes;
}
function fourBytes(pointer:number) {
  return [0x81+Math.floor(pointer/12600),0x30+Math.floor(pointer/1260)%10,0x81+Math.floor(pointer/10)%126,0x30+pointer%10];
}
function encodedBytes(char:string):number[]|undefined {
  const code=char.codePointAt(0)!;
  if(code<0x80) return [code];
  const pair=twoByteTable().get(char);
  if(pair!==undefined) return [pair>>8,pair&255];
  if(code>=0x10000) return fourBytes(189000+code-0x10000);
  // The GB18030 four-byte region for BMP characters is in Unicode code-point order.
  let low=0,high=39419;
  while(low<=high) {
    const middle=(low+high)>>>1;
    const bytes=fourBytes(middle);
    const at=decoder.decode(Uint8Array.from(bytes)).codePointAt(0)!;
    if(at===code) return bytes;
    if(at<code) low=middle+1;
    else high=middle-1;
  }
}
export function jinjiangSearchUrl(term:string) {
  const base='https://www.jjwxc.net/search.php';
  const bytes:number[]=[];
  for(const char of term) {
    const part=encodedBytes(char);
    if(!part) return base;
    bytes.push(...part);
  }
  return base+'?kw='+bytes.map(byte=>'%'+byte.toString(16).toUpperCase().padStart(2,'0')).join('')+'&t=1&version=1';
}
