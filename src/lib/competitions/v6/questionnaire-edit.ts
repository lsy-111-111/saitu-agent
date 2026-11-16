/** Browser-safe mapping: record only controls actually changed, never the whole re-signed questionnaire. */
export const contextFactFields: Record<string,string[]> = {
  goalIntent:["goalIntent"],goalResolution:["goalResolution"],primaryGoal:["primaryGoal"],
  budget:["budget","budget.maximumYuan"],preparationHorizon:["preparationHorizon"],fixedTeam:["fixedTeam"],
  excludedTaskFormats:["excludedTask"],unavailableResources:["unavailableResource"],obtainableResources:["obtainableResource"],noviceTaskPreferences:["noviceTask"],
  experienceStatus:["experienceStatus"],businessActivity:["businessActivity"],
  experiences:[1,2].flatMap(i=>["task","contribution","completion","challenge"].map(f=>`experience.${i}.${f}`)),
};
export function changedContextFields(previous:Record<string,unknown>, next:Record<string,unknown>) {
  return Object.entries(contextFactFields).flatMap(([key,fields])=>{
    if(JSON.stringify(previous[key])===JSON.stringify(next[key]))return [];
    if(key!=="experiences")return fields;
    const before=(previous[key]??[]) as Record<string,unknown>[], after=(next[key]??[]) as Record<string,unknown>[];
    return fields.filter(field=>{const [,index,part]=field.split(".");return JSON.stringify(before[Number(index)-1]?.[part])!==JSON.stringify(after[Number(index)-1]?.[part])||before[Number(index)-1]?.confirmed!==after[Number(index)-1]?.confirmed;});
  });
}
