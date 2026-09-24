import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

const logoPath = fileURLToPath(new URL('./assets/eyazs-logo.png', import.meta.url));
const color = {ink:'#14343D',muted:'#667F85',green:'#147D6A',pale:'#F1F7F5',line:'#DEE8E5',white:'#FFFFFF'};
const number = value => Number(value || 0).toLocaleString('pt-MZ');
const money = value => Number(value || 0).toLocaleString('pt-MZ',{minimumFractionDigits:2,maximumFractionDigits:2})+' MTn';
const day = value => String(value).slice(0,10).split('-').reverse().join('/');

export function renderCommercialReport(data, generatedAt = new Date()) {
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margin:40,bufferPages:true,info:{Title:'Relatório comercial | Eyazs',Author:'Eyazs Imperium Lda',Subject:'Resultados comerciais do Hotspot Eyazs'}});
    const chunks=[];
    doc.on('data',chunk=>chunks.push(chunk));doc.on('error',reject);
    doc.on('end',()=>resolve(Buffer.concat(chunks)));
    try {
      const left=40,width=doc.page.width-80,right=left+width;
      const period=day(data.range.from)+' a '+day(data.range.to);
      const issued=new Intl.DateTimeFormat('pt-MZ',{timeZone:'Africa/Maputo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(generatedAt);
      const text=(value,x,y,size=10,fill=color.ink,options={})=>{
        doc.font(options.bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor(fill)
          .text(String(value),x,y,{width:width,lineBreak:false,...options});
      };
      const rule=y=>doc.moveTo(left,y).lineTo(right,y).lineWidth(.6).strokeColor(color.line).stroke();
      const brand=()=>{
        doc.rect(0,0,doc.page.width,6).fill(color.green);
        doc.image(logoPath,left,28,{fit:[58,58]});
        text('eyazs',110,35,28,color.ink,{bold:true});
        text('EYAZS IMPERIUM LDA',111,69,8,color.muted,{characterSpacing:1.2});
        text('HOTSPOT EYAZS',right-160,39,9,color.green,{bold:true,width:160,align:'right'});
        text('Gestão comercial',right-160,58,9,color.muted,{width:160,align:'right'});
        rule(104);
      };
      brand();
      text('Relatório comercial',left,127,26,color.ink,{bold:true});
      text('Período: '+period,left,167,11,color.muted);
      text('Emitido em '+issued+' | Maputo',left,186,8,color.muted);

      doc.roundedRect(left,213,width,98,9).fill(color.green);
      text('RECEITA NO PERÍODO',left+20,230,9,color.white,{bold:true,characterSpacing:.8});
      text(money(data.summary.revenue),left+20,253,29,color.white,{bold:true,width:325});
      doc.moveTo(right-138,230).lineTo(right-138,292).strokeColor('#58A895').lineWidth(.7).stroke();
      text(number(data.summary.approved),right-120,233,27,color.white,{bold:true,width:102});
      text('Pagamentos\naprovados',right-120,269,9,color.white,{width:102,lineBreak:true,lineGap:2});

      const metrics=[['Pagamentos registados',number(data.summary.payments)],['Pendentes',number(data.summary.pending)],['Cancelados',number(data.summary.canceled)],['Valor médio',money(data.summary.average)]];
      const gap=10,cardWidth=(width-gap*3)/4;
      metrics.forEach(([label,value],index)=>{
        const x=left+index*(cardWidth+gap);
        doc.roundedRect(x,326,cardWidth,70,7).fill(color.pale);
        text(label,x+11,340,8,color.muted,{width:cardWidth-22});
        text(value,x+11,360,index===3?14:21,color.ink,{bold:true,width:cardWidth-22});
      });

      let y=429;
      const tableHeader=()=>{
        text('Vendas por pacote',left,y,15,color.ink,{bold:true});y+=31;
        doc.roundedRect(left,y,width,30,4).fill(color.ink);
        text('PACOTE',left+12,y+10,8,color.white,{bold:true,width:240});
        text('APROVADOS',left+266,y+10,8,color.white,{bold:true,width:80,align:'right'});
        text('RECEITA',left+362,y+10,8,color.white,{bold:true,width:width-374,align:'right'});
        y+=30;
      };
      const nextPage=()=>{
        doc.addPage();brand();
        text('Relatório comercial | Continuação',left,126,16,color.ink,{bold:true});
        text(period,left,152,10,color.muted);y=187;tableHeader();
      };
      tableHeader();
      if(!data.packages.length) {
        text('Sem vendas no período selecionado.',left+12,y+20,10,color.muted);y+=59;
      }
      data.packages.forEach((item,index)=>{
        doc.font('Helvetica').fontSize(10);
        const height=Math.max(44,doc.heightOfString(String(item.name),{width:238})+24);
        // Keep the final package and its total on the same page.
        const reserve=index===data.packages.length-1?43:0;
        if(y+height+reserve>754)nextPage();
        if(index%2===0)doc.rect(left,y,width,height).fill(color.pale);
        text(item.name,left+12,y+14,10,color.ink,{width:238,lineBreak:true});
        text(number(item.approved),left+266,y+14,10,color.ink,{width:80,align:'right'});
        text(money(item.revenue),left+354,y+14,10,color.ink,{bold:true,width:width-366,align:'right'});
        y+=height;rule(y);
      });
      if(y+51>754)nextPage();
      doc.rect(left,y,width,43).fill('#E3EFEA');
      text('Total do período',left+12,y+15,10,color.ink,{bold:true,width:240});
      text(number(data.summary.approved),left+266,y+15,10,color.ink,{bold:true,width:80,align:'right'});
      text(money(data.summary.revenue),left+354,y+15,10,color.green,{bold:true,width:width-366,align:'right'});

      const {start,count}=doc.bufferedPageRange();
      for(let page=start;page<start+count;page++) {
        doc.switchToPage(page);rule(781);
        text('EYAZS IMPERIUM LDA',left,792,8,color.muted,{width:240});
        text('Página '+(page-start+1)+' de '+count,right-120,792,8,color.muted,{width:120,align:'right'});
      }
      doc.end();
    } catch(error) { doc.destroy();reject(error); }
  });
}
