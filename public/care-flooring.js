export const CARE_FLOORING = {
 wood: {name:'木地板',color:'#b69a7b',finish:'matte timber',advice:'適合乾爽的客廳或睡房，腳感較溫和。請核對防滑資料、接縫與收邊，受潮時要及時抹乾。'},
 tile: {name:'瓷磚',color:'#d6cec0',finish:'matte porcelain tile',advice:'浴室和廚房可考慮有濕態防滑測試的瓷磚。請核對排水、積水及門口高差。'},
 carpet: {name:'地毯',color:'#9c9189',finish:'fixed low-pile carpet',advice:'適合想減少聲響的乾區。選固定、低絨款並收平邊緣。輪椅或助行器常走的路線優先考慮平整硬地面。'}
};

export function flooringAdvice(material, kind, profile) {
 const option = CARE_FLOORING[material];
 if (!option) return '按房間用途選擇地面。請核對實物的防滑、維護及收邊。';
 if (material === 'carpet' && ['bathroom','kitchen'].includes(kind)) return '這是容易沾水的房間。建議比較有濕態防滑資料、容易清潔的瓷磚。';
 if (material === 'carpet' && profile === 'wheelchair') return '這個方案有輪椅使用需求。固定低絨地毯也需要試推，並核對接縫及收邊。';
 return option.advice;
}
