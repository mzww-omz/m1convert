import {ascii} from './formats.ts';
import {audioFormats} from './audio-formats.ts';
export const MAX_AUDIO_SAMPLES=8_000_000;
export function audioBounds(rate:number,channels:number,samples:number) {
	if(!Number.isInteger(rate)||rate<8000||rate>192000) throw new Error('Unsupported audio sample rate (8000–192000 Hz).');
	if(![1,2].includes(channels)) throw new Error('Only mono/stereo audio channels are supported.');
	if(!Number.isInteger(samples)||samples<0||samples>MAX_AUDIO_SAMPLES) throw new Error('Audio exceeds the 8 million decoded samples limit.');
}
function corrupt(name:string):never {throw new Error(`Corrupt, truncated or unsupported ${name} audio structure.`);}
const rates=[96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000];
const oggTable=Uint32Array.from({length:256},(_,n)=>{n<<=24;for(let i=0;i<8;i++)n=(n&0x80000000)?n<<1^0x04c11db7:n<<1;return n>>>0;});
function ogg(b:Uint8Array) {
	const v=new DataView(b.buffer,b.byteOffset,b.length);let p=0,serial=-1,sequence=0,ended=false,codec='',rate=0,channels=0;
	while(p<b.length) {
		if(ended||p+27>b.length||ascii(b,p,4)!=='OggS'||b[p+4]!==0) corrupt('Ogg');
		const n=b[p+26],data=p+27+n;if(data>b.length) corrupt('Ogg');
		const end=data+b.subarray(p+27,data).reduce((s,n)=>s+n,0);if(end>b.length) corrupt('Ogg');
		if(p===0) {
			if(!(b[p+5]&2)||b[p+5]&1) corrupt('Ogg');serial=v.getUint32(p+14,true);
			if(ascii(b,data,8)==='OpusHead') {if(data+19>end||b[data+8]!==1||b[data+18]!==0) corrupt('Opus');codec='OPUS';channels=b[data+9];rate=48000;}
			else if(b[data]===1&&ascii(b,data+1,6)==='vorbis') {if(data+30>end||v.getUint32(data+7,true)!==0) corrupt('Vorbis');codec='OGG';channels=b[data+11];rate=v.getUint32(data+12,true);}
			else throw new Error('Only Ogg Vorbis or Ogg Opus audio is supported.');
			audioBounds(rate,channels,0);
		} else if(b[p+5]&2) corrupt('chained Ogg');
		if(v.getUint32(p+14,true)!==serial||v.getUint32(p+18,true)!==sequence++) corrupt('multiplexed Ogg');
		let crc=0;for(let i=p;i<end;i++)crc=(crc<<8)^oggTable[((crc>>>24)^(i>=p+22&&i<p+26?0:b[i]))&255];
		if((crc>>>0)!==v.getUint32(p+22,true)) throw new Error('Ogg page checksum mismatch.');
		ended=!!(b[p+5]&4);p=end;
	}
	if(!ended) corrupt('Ogg');return {format:codec,rate,channels};
}
function mp3(b:Uint8Array) {
	let p=0,rate=0,channels=0,frames=0;
	if(ascii(b,0,3)==='ID3') {
		if(b.length<10||![3,4].includes(b[3])||b.subarray(6,10).some(n=>n&128)) corrupt('MP3 ID3');
		const size=(b[6]<<21)+(b[7]<<14)+(b[8]<<7)+b[9];if(size>4*1024**2) throw new Error('MP3 metadata exceeds the 4 MiB limit.');
		p=10+size+(b[3]===4&&(b[5]&16)?10:0);
	}
	const end=ascii(b,b.length-128,3)==='TAG'?b.length-128:b.length;
	while(p<end) {
		if(p+4>end||b[p]!==255||(b[p+1]&0xe0)!==0xe0||(b[p+1]&6)!==2) corrupt('MP3');
		const version=b[p+1]>>3&3,index=b[p+2]>>4,sr=b[p+2]>>2&3;if(version===1||index===0||index===15||sr===3) corrupt('MP3');
		const hz=[44100,48000,32000][sr]/(version===3?1:version===2?2:4),ch=(b[p+3]>>6)===3?1:2;
		const bitrate=(version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[index];
		const length=Math.floor((version===3?144000:72000)*bitrate/hz)+(b[p+2]>>1&1);
		if(p+length>end||(rate&&(rate!==hz||channels!==ch))) corrupt('MP3');rate=hz;channels=ch;frames++;p+=length;
	}
	if(!frames) corrupt('MP3');audioBounds(rate,channels,0);return {format:'MP3',rate,channels};
}
function flac(b:Uint8Array) {
	const v=new DataView(b.buffer,b.byteOffset,b.length);let p=4,last=false,rate=0,channels=0,total=0;
	while(!last) {
		if(p+4>b.length||p>4*1024**2) corrupt('FLAC');last=!!(b[p]&128);const type=b[p]&127,n=b[p+1]*65536+b[p+2]*256+b[p+3];
		if(p+4+n>b.length) corrupt('FLAC');
		if(p===4) {
			if(type!==0||n!==34) corrupt('FLAC');
			rate=(b[p+14]<<12)|(b[p+15]<<4)|(b[p+16]>>4);channels=(b[p+16]>>1&7)+1;
			total=(b[p+17]&15)*2**32+v.getUint32(p+18);audioBounds(rate,channels,total*channels);
		} else if(type===0) corrupt('FLAC');p+=4+n;
	}
	if(p>=b.length) corrupt('FLAC');return {format:'FLAC',rate,channels,total};
}
function adts(b:Uint8Array) {
	let p=0,rate=0,channels=0,frames=0;
	while(p<b.length) {
		if(p+7>b.length||b[p]!==255||(b[p+1]&0xf6)!==0xf0) corrupt('AAC/ADTS');
		const hz=rates[b[p+2]>>2&15],ch=(b[p+2]&1)<<2|b[p+3]>>6,length=(b[p+3]&3)<<11|b[p+4]<<3|b[p+5]>>5;
		if((b[p+2]>>6)!==1||(b[p+6]&3)||!hz||length<(b[p+1]&1?7:9)||p+length>b.length||(rate&&(rate!==hz||channels!==ch))) corrupt('AAC-LC/ADTS');
		rate=hz;channels=ch;frames++;p+=length;
	}
	if(!frames) corrupt('AAC');audioBounds(rate,channels,frames*1024*channels);return {format:'AAC',rate,channels};
}
function mp4(b:Uint8Array) {
	const v=new DataView(b.buffer,b.byteOffset,b.length);let p=0,moov=0,mdat=0,boxes=0,tracks=0,descriptions=0;
	function children(start:number,end:number,depth:number) {
		if(depth>16)corrupt('MP4 nesting');
		for(let p=start;p<end;) {
			if(++boxes>10000||p+8>end)corrupt('MP4');const size=v.getUint32(p),type=ascii(b,p+4,4),data=p+8,stop=p+size;
			if(size<8||stop>end)corrupt('MP4 child box');
			if(type==='trak'&&++tracks>1)throw new Error('Only single-track AAC audio is supported in M4A.');
			if(['trak','mdia','minf','stbl','edts','dinf'].includes(type))children(data,stop,depth+1);
			if(type==='stsd') {
				if(++descriptions>1||data+16>stop||v.getUint32(data+4)!==1)corrupt('MP4 sample description');
				const entry=data+8,entrySize=v.getUint32(entry);if(entrySize<36||entry+entrySize!==stop)corrupt('MP4 audio sample entry');
				if(ascii(b,entry+4,4)!=='mp4a')throw new Error('Only the AAC audio codec is supported in M4A.');
				if(v.getUint16(entry+16)!==0)corrupt('QuickTime audio');audioBounds(v.getUint32(entry+32)>>>16,v.getUint16(entry+24),0);
			}
			const widths:Record<string,number>={stts:8,ctts:8,stsc:12,stco:4,co64:8,stss:4};
			if(widths[type]) {
				if(data+8>stop)corrupt('MP4 sample table');const count=v.getUint32(data+4);if(count>100000||data+8+count*widths[type]!==stop)corrupt('MP4 sample table count');
				if(type==='stco'||type==='co64')for(let j=0;j<count;j++) {
					const at=data+8+j*widths[type];if(type==='co64'&&v.getUint32(at))corrupt('MP4 chunk offset');
					if(v.getUint32(at+(type==='co64'?4:0))>=b.length)corrupt('MP4 chunk offset');
				}
			}
			if(type==='stsz') {
				if(data+12>stop)corrupt('MP4 sample size table');const fixed=v.getUint32(data+4),count=v.getUint32(data+8);
				if(count>100000||data+12+(fixed?0:count*4)!==stop)corrupt('MP4 sample size table count');
				let bytes=fixed*count;if(!fixed)for(let j=0;j<count;j++)bytes+=v.getUint32(data+12+j*4);
				if(bytes>b.length)corrupt('MP4 sample sizes');
			}
			if(type==='stz2')throw new Error('Compact MP4 sample tables are not supported.');
			p=stop;
		}
	}
	while(p<b.length) {
		if(++boxes>10000||p+8>b.length) corrupt('MP4');const type=ascii(b,p+4,4);let length=v.getUint32(p);
		if(length===1){if(p+16>b.length||v.getUint32(p+8))corrupt('MP4');length=v.getUint32(p+12);if(length<16)corrupt('MP4');}
		if(length===0)length=b.length-p;if(length<8||p+length>b.length)corrupt('MP4');
		if(type==='moof'||type==='sidx')throw new Error('Fragmented M4A is not supported.');
		if(type==='moov'){moov++;children(p+8,p+length,0);}if(type==='mdat')mdat++;p+=length;
	}
	if(moov!==1||!mdat||tracks!==1||descriptions!==1)corrupt('MP4');return {format:'M4A'};
}
export function inspectAudioBytes(file:File,b:Uint8Array) {
	if(!b.length||b.length>64*1024**2)throw new Error('Audio is empty or exceeds the size limit.');
	const def=audioFormats.find(f=>f.matches(b));if(!def)throw new Error('Unsupported audio contents.');
	const ext=file.name.includes('.')?file.name.split('.').pop()!.toLowerCase():'';
	if(ext&&!def.extensions.includes(ext))throw new Error('Audio extension does not match its contents.');
	const aliases:Record<string,string[]>={WAV:['audio/x-wav','audio/wave','audio/vnd.wave'],AIFF:['audio/x-aiff'],MP3:['audio/mp3'],FLAC:['audio/x-flac'],OGG:['application/ogg'],OPUS:['audio/ogg','application/ogg'],AAC:['audio/aacp','audio/x-aac'],M4A:['audio/x-m4a','video/mp4']};
	if(file.type&&!['application/octet-stream',def.mime,...aliases[def.id]??[]].includes(file.type))throw new Error('Audio MIME does not match its contents.');
	if(def.id==='MP3')return mp3(b);if(def.id==='FLAC')return flac(b);if(['OGG','OPUS'].includes(def.id))return ogg(b);if(def.id==='AAC')return adts(b);if(def.id==='M4A')return mp4(b);return {format:def.id};
}
