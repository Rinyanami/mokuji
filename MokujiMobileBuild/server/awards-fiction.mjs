// Public bibliographic facts and source citations. Honors for adaptations and authors
// are labeled separately from selections of the novel itself.
const sources = [
  "https://www.chinawriter.com.cn/n1/2024/0428/c404023-40225996.html",
  "https://www.chinawriter.com.cn/n1/2025/0618/c404023-40503316.html",
  "https://www.chinawriter.com.cn/n1/2026/0730/c403993-40771203.html",
  "https://www.chinawriter.com.cn/n1/2023/1225/c403994-40146279.html",
  "https://www.chinawriter.com.cn/n1/2025/0113/c403994-40400797.html",
  "https://www.chinawriter.com.cn/n1/2025/1221/c403994-40628859.html",
  "https://www.chinawriter.com.cn/n1/2026/1028/c404023-40823284.html",
  "https://www.thepaper.cn/newsDetail_forward_25960936",
  "https://www.sczjw.net.cn/news/detail/888950224704552960.html"
];
const entries = [
  ["十日终焉","杀虫队队员","核心作品交叉","番茄小说","https://fanqienovel.com/page/7143038691944959011",[[2024,"中国作协","网络小说榜","work",1],[2024,"中国小说学会","网络小说","work",4],[2026,"天马文学奖","第三届获奖作品","work",6]]],
  ["天才俱乐部","城城与蝉","核心作品交叉","起点中文网",null,[[2024,"中国作协","网络小说榜","work",1],[2024,"中国小说学会","网络小说","work",4],[2026,"天马文学奖","第三届获奖作品","work",6],[2024,"阅文集团","十二天王作者代表作","author",8]]],
  ["剑来","烽火戏诸侯","核心作品交叉","纵横中文网","https://www.zongheng.com/detail/672340",[[2024,"中国作协","IP影响榜","ip",1],[2025,"中国作协","网络小说榜","work",2],[2025,"中国小说学会","网络小说","work",5],[2026,"天马文学奖","第三届获奖作品","work",6]]],
  ["深海余烬","远瞳","核心作品交叉","起点中文网",null,[[2024,"中国作协","网络小说榜","work",1],[2024,"中国小说学会","网络小说","work",4]]],
  ["我有一剑","青鸾峰上","核心作品交叉","纵横中文网","https://www.zongheng.com/detail/1215341",[[2024,"中国作协","网络小说榜","work",1],[2024,"中国小说学会","网络小说","work",4]]],
  ["谁让他修仙的！","最白的乌鸦","核心作品交叉","起点中文网",null,[[2025,"中国作协","网络小说榜","work",2,"谁让他修仙的"],[2025,"中国小说学会","网络小说","work",5],[2023,"阅文集团","十二天王作者代表作","author",7]]],
  ["道诡异仙","狐尾的笔","核心作品交叉","起点中文网",null,[[2023,"中国作协","网络小说榜","work",0],[2024,"中国作协","IP影响榜","ip",1],[2023,"中国小说学会","网络小说","work",3]]],
  ["我在精神病院学斩神","三九音域","核心作品交叉","番茄小说","https://fanqienovel.com/page/6982529841564224526",[[2023,"中国作协","网络小说榜","work",0,"夜幕之下（我在精神病院学斩神）"],[2024,"中国作协","IP影响榜","ip",1],[2023,"中国小说学会","网络小说","work",3]]],
  ["洛九针","希行","核心作品交叉","起点中文网",null,[[2023,"中国作协","网络小说榜","work",0],[2023,"中国小说学会","网络小说","work",3]]],
  ["宿命之环","爱潜水的乌贼","含IP/海外跨评选","起点中文网",null,[[2023,"中国作协","海外传播榜","overseas",0],[2025,"中国小说学会","网络小说","work",5]]],
  ["一品布衣","李破山","含IP/海外跨评选","17K小说网","https://h5.17k.com/book/3420911.html",[[2025,"中国作协","IP影响榜","ip",2],[2025,"中国小说学会","网络小说","work",5]]],
  ["我本无意成仙","金色茉莉花","含作者代表作","起点中文网",null,[[2024,"中国小说学会","网络小说","work",4],[2023,"阅文集团","十二天王作者代表作","author",7]]],
  ["万世之名","古羲","含作者代表作","起点中文网",null,[[2024,"中国作协","海外传播榜","overseas",1],[2024,"阅文集团","十二天王作者代表作","author",8]]],
  ["黑月光拿稳BE剧本","藤萝为枝","同体系跨类别","晋江文学城","https://www.jjwxc.net/onebook.php?novelid=4398312",[[2023,"中国作协","IP影响榜","ip",0,"长月烬明"],[2025,"中国作协","海外传播榜","overseas",2,"长月烬明"]]]
];

export const awardFiction = entries.map(([title, author, crossType, platform, detailUrl, rawAwards]) => ({
  id: 'award:' + title,
  title, author, crossType, platform,
  linkKind: detailUrl ? 'detail' : 'search',
  officialUrl: detailUrl || 'https://www.qidian.com/search?kw=' + encodeURIComponent(title),
  awards: rawAwards.map(([year, organization, category, kind, sourceIndex, originalTitle]) => ({
    year, organization, category, kind, url: sources[sourceIndex], originalTitle: originalTitle || title,
  })),
}));
export function listAwardFiction() {
  return awardFiction.map(book => ({...book, awards:book.awards.map(award=>({...award}))}));
}
