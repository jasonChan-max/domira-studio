import {itemBounds} from './domain.js';

export function validateCareToilet(room,toilet){
 if(toilet===undefined)return;
 if(!toilet||!['x','z','w','d','rotation'].every(key=>Number.isFinite(toilet[key]))||
    ![0,90,180,270].includes(toilet.rotation)||!['left','right','either'].includes(toilet.transferSide)||
    ![toilet.w,toilet.d].every(size=>size>=.15&&size<=2))throw Error('請輸入有效的座廁尺寸、方向和轉移側。');
 const {w,d}=itemBounds(toilet);
 if(Math.abs(toilet.x)+w/2>room.width/2+.001||Math.abs(toilet.z)+d/2>room.depth/2+.001)throw Error('座廁超出房間邊界。請核對位置和尺寸。');
}

export function careToiletObstacle(toilet){
 return {...toilet,id:'fixed-toilet',name:'固定座廁',type:'toilet-footprint'};
}
