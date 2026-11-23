import * as chineseFiction from './cn-open.mjs';
import * as indieFiction from './indie-fiction.mjs';
import * as englishBooks from './foreign-open.mjs';
import * as wikisource from './open-books.mjs';
import * as aozora from './external-books.mjs';
import * as collections from './chinese-collections.mjs';

const providers = [
  { webFiction:true, list: indieFiction.listBooks, detail: indieFiction.getBook, chapter: indieFiction.getChapter },
  { webFiction:true, list: chineseFiction.listBooks, detail: chineseFiction.getBook, chapter: chineseFiction.getChapter },
  { list: englishBooks.listBooks, detail: englishBooks.getBook, chapter: englishBooks.getChapter },
  { list: wikisource.listOpenBooks, detail: wikisource.getOpenBook, chapter: wikisource.getOpenChapter },
  { list: aozora.listExternalBooks, detail: aozora.getExternalBook, chapter: aozora.getExternalChapter },
  { list: collections.listCollections, detail: collections.getCollection, chapter: collections.getCollectionChapter },
];
const catalog = new Map();
for (const provider of providers) {
  for (const book of provider.list()) {
    if (catalog.has(book.id)) throw new Error('Duplicate online book ID: ' + book.id);
    catalog.set(book.id, { book, provider });
  }
}

export function listOnlineBooks() {
  return Array.from(catalog.values(), entry => entry.book);
}

export function listWebFictionBooks() {
  return Array.from(catalog.values()).filter(entry => entry.provider.webFiction).map(entry => entry.book);
}

export function findOnlineBook(id) {
  return catalog.get(id)?.book ?? null;
}

export function onlineDetails(id) {
  return catalog.get(id)?.provider.detail(id) ?? null;
}

export function onlineChapter(id, n) {
  return catalog.get(id)?.provider.chapter(id, n) ?? null;
}
