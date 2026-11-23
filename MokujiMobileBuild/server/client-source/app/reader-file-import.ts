import { readerRequest, type ReaderBook } from './reading-client';

export const readerFileAccept='.txt,.text,.epub,.cbz,.zip,text/plain,application/epub+zip,application/vnd.comicbook+zip,application/zip';
type FileMetadata={title?:string;author?:string;workId?:string};

export async function importBookFile(file:File,options:FileMetadata={}):Promise<ReaderBook> {
  if(!/\.(?:te?xt|epub|cbz|zip)$/i.test(file.name) && !['text/plain','application/epub+zip','application/vnd.comicbook+zip','application/zip','application/x-zip-compressed'].includes(file.type))throw new Error('请选择 TXT、EPUB 或 CBZ/ZIP 漫画文件。');
  if(file.size>60*1024*1024)throw new Error('单个文件上限为 60 MiB。');
  const body=new FormData();
  body.append('file',file);
  for(const [key,value] of Object.entries(options))if(value?.trim())body.append(key,value.trim());
  const {book}=await readerRequest<{book:ReaderBook}>('import',{method:'POST',body});
  return book;
}
