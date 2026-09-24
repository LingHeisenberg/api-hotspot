import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

const logoPath = fileURLToPath(new URL('./assets/eyazs-logo.png', import.meta.url));
const color = {ink:'#18373D',muted:'#647A7E',teal:'#167B6A',pale:'#F3F7F5',line:'#DCE5E2',white:'#FFFFFF',accent:'#BBD9CB'};
const number = value => Number(value || 0).toLocaleString('pt-MZ');
const decimal = value => Number(value || 0).toLocaleString('pt-MZ',{minimumFractionDigits:2,maximumFractionDigits:2});
const money = value => decimal(value)+' MTn';
const day = value => String(value).slice(0,10).split('-').reverse().join('/');

export function renderCommercialReport(data, generatedAt = new Date()) {
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({
      size:'A4',margin:44,bufferPages:true,
      info:{Title:'Relatório comercial | Eyazs',Author:'Eyazs Imperium Lda',Subject:'Resultados comerciais do Hotspot Eyazs'}
    });
    const chunks=[];
    doc.on('data',chunk=>chunks.push(chunk));doc.on('error',reject);
    doc.on('end',()=>resolve(Buffer.concat(chunks)));
    try {
      const left=44,width=doc.page.width-88,right=left+width;
      const period=day(data.range.from)+' a '+day(data.range.to);
      const issued=new Intl.DateTimeFormat('pt-MZ',{
        timeZone:'Africa/Maputo',day:'2-digit',month:'2-digit',year:'numeric',
        hour:'2-digit',minute:'2-digit',hour12:false
      }).format(generatedAt);
      const text=(value,x,y,size=10,fill=color.ink,options={})=>{
        const {bold=false,serif=false,...layout}=options;
        doc.font(serif?'Times-Roman':bold?'Helvetica-Bold':'Helvetica')
          .fontSize(size).fillColor(fill)
          .text(String(value),x,y,{width:right-x,lineBreak:false,...layout});
      };
      const fitted=(value,x,y,size,fill,options={})=>{
        doc.font(options.bold?'Helvetica-Bold':'Helvetica').fontSize(size);
        const available=options.width||right-x;
        while(doc.widthOfString(String(value))>available && size>6)doc.fontSize(size-=.5);
        text(value,x,y,size,fill,options);
      };
      const line=(y,x1=left,x2=right,stroke=color.line,weight=.6)=>{
        doc.moveTo(x1,y).lineTo(x2,y).lineWidth(weight).strokeColor(stroke).stroke();
      };
      const eyebrow=(value,x,y,options={})=>text(value,x,y,7.5,color.muted,{bold:true,characterSpacing:1,...options});
      const brand=()=>{
        doc.image(logoPath,left,33,{fit:[44,44]});
        text('eyazs',101,35,23,color.ink,{bold:true});
        text('EYAZS IMPERIUM LDA',102,63,7,color.muted,{characterSpacing:1});
        eyebrow('GESTÃO & RESULTADOS',right-180,39,{width:180,align:'right'});
        text('Hotspot Eyazs',right-180,58,9,color.muted,{width:180,align:'right'});
        line(94);
      };
      brand();
      text('Relatório comercial',left,119,33,color.ink,{serif:true});
      text('Desempenho financeiro e vendas por pacote',left,160,10,color.muted);
      eyebrow('PERÍODO DE ANÁLISE',left,192);
      text(period,left,207,10,color.ink,{bold:true});
      eyebrow('EMISSÃO · HORA DE MAPUTO',right-183,192,{width:183,align:'right'});
      text(issued,right-183,207,9,color.ink,{width:183,align:'right'});

      // One financial highlight followed by a restrained typographic metric row.
      const heroY=254;
      eyebrow('01  /  RESUMO FINANCEIRO',left,237);
      doc.rect(left,heroY,width,104).fill(color.ink);
      doc.rect(left,heroY,3,104).fill(color.teal);
      text('RECEITA NO PERÍODO',left+19,heroY+17,8,color.accent,{bold:true,characterSpacing:1});
      fitted(money(data.summary.revenue),left+19,heroY+43,33,color.white,{bold:true,width:325});
      doc.moveTo(right-137,heroY+19).lineTo(right-137,heroY+86).lineWidth(.6).strokeColor('#466165').stroke();
      fitted(number(data.summary.approved),right-118,heroY+19,31,color.white,{bold:true,width:99});
      text('Pagamentos aprovados',right-118,heroY+64,8,color.accent,{width:99,lineBreak:true,lineGap:2});

      const metrics=[
        ['Pagamentos registados',number(data.summary.payments)],
        ['Valor médio',money(data.summary.average)],
        ['Pendentes',number(data.summary.pending)],
        ['Cancelados',number(data.summary.canceled)]
      ];
      const cell=width/4;
      metrics.forEach(([label,value],index)=>{
        const x=left+index*cell;
        if(index)doc.moveTo(x-10,377).lineTo(x-10,421).lineWidth(.6).strokeColor(color.line).stroke();
        text(label,x,378,8,color.muted,{width:cell-18});
        fitted(value,x,398,index===1?18:23,color.ink,{bold:true,width:cell-18});
      });
      line(438);

      let y=463;
      const packageWidth=176,approvedX=left+198,approvedWidth=50;
      const revenueX=left+263,revenueWidth=102,shareX=left+383,shareWidth=width-395;
      const tableHeader=(continued=false)=>{
        eyebrow('02  /  VENDAS POR PACOTE',left,y);
        text(continued?'Continuação':data.packages.length+' '+(data.packages.length===1?'pacote':'pacotes'),right-100,y,8,color.muted,{width:100,align:'right'});
        y+=25;
        doc.rect(left,y,width,29).fill(color.pale);
        text('PACOTE',left+11,y+10,7,color.muted,{bold:true,characterSpacing:.6,width:packageWidth});
        text('APROVADOS',approvedX-14,y+10,7,color.muted,{bold:true,width:approvedWidth+14,align:'right'});
        text('RECEITA',revenueX,y+10,7,color.muted,{bold:true,width:revenueWidth,align:'right'});
        text('PARTICIPAÇÃO',shareX,y+10,7,color.muted,{bold:true,width:shareWidth,align:'right'});
        y+=29;
      };
      const nextPage=()=>{
        doc.addPage();brand();
        text('Relatório comercial',left,116,23,color.ink,{serif:true});
        text(period,left,148,9,color.muted);
        y=185;tableHeader(true);
      };
      tableHeader();
      if(!data.packages.length){
        text('Sem vendas no período selecionado.',left+11,y+22,10,color.muted);y+=64;
      }
      data.packages.forEach((item,index)=>{
        doc.font('Helvetica').fontSize(10);
        const height=Math.max(49,doc.heightOfString(String(item.name),{width:packageWidth})+28);
        const reserve=index===data.packages.length-1?48:0;
        if(y+height+reserve>748)nextPage();
        text(item.name,left+11,y+17,10,color.ink,{width:packageWidth,lineBreak:true});
        fitted(number(item.approved),approvedX,y+17,10,color.ink,{width:approvedWidth,align:'right'});
        fitted(money(item.revenue),revenueX,y+17,10,color.ink,{bold:true,width:revenueWidth,align:'right'});
        const share=Number(data.summary.revenue)>0?Number(item.revenue)/Number(data.summary.revenue):0;
        const percent=(share*100).toLocaleString('pt-MZ',{maximumFractionDigits:1})+'%';
        const barWidth=46;
        doc.rect(shareX,y+23,barWidth,3).fill(color.line);
        if(share>0)doc.rect(shareX,y+23,barWidth*Math.min(share,1),3).fill(color.teal);
        fitted(percent,shareX+barWidth+7,y+17,9,color.muted,{width:shareWidth-barWidth-7,align:'right'});
        y+=height;line(y);
      });
      if(y+48>748)nextPage();
      line(y,left,right,color.ink,.8);
      text('TOTAL DO PERÍODO',left+11,y+18,8,color.ink,{bold:true,characterSpacing:.5,width:packageWidth});
      fitted(number(data.summary.approved),approvedX,y+16,12,color.ink,{bold:true,width:approvedWidth,align:'right'});
      fitted(money(data.summary.revenue),revenueX,y+16,12,color.teal,{bold:true,width:revenueWidth,align:'right'});
      text(Number(data.summary.revenue)>0?'100%':'0%',shareX,y+18,9,color.muted,{width:shareWidth,align:'right'});

      const {start,count}=doc.bufferedPageRange();
      for(let page=start;page<start+count;page++){
        doc.switchToPage(page);line(778);
        text('EYAZS IMPERIUM LDA',left,786,7,color.muted,{characterSpacing:.6,width:230});
        text('Relatório comercial',left+220,786,7,color.muted,{width:140,align:'center'});
        text('Página '+(page-start+1)+' de '+count,right-100,786,7,color.muted,{width:100,align:'right'});
      }
      doc.end();
    } catch(error){doc.destroy();reject(error);}
  });
}
