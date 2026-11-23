export default class QRCode {
  constructor(typeNumber:number, errorCorrectionLevel:number);
  addData(value:string):void;
  make():void;
  getModuleCount():number;
  isDark(row:number,col:number):boolean;
}
