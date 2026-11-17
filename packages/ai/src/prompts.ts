export const PROMPT_VERSION = 'v3'

export function claimPrompt(markdown: string) {
  return `你是事實查核的前處理。從下面的 Markdown 筆記抽出可查證的事實主張。
排除意見、感嘆、純定義標題與純數學符號。text 必須逐字複製原文中的一句或一段（不要改寫、不要刪掉符號或公式），並給出 spanStart / spanEnd（以 JavaScript 字串索引計，含 start 不含 end）。
用繁體中文理解內容。只輸出符合 schema 的 JSON。

筆記：
${markdown}`
}

export function verdictPrompt(claims: unknown, evidence: unknown) {
  return `你是謹慎的事實查核員。根據證據對每條主張給出 supported、contradicted、uncertain 或 not_checkable。
規則：
- 沒有足夠證據就用 uncertain，不要假裝確定。
- contradicted 必須提供 suggestedFix。
- 引用只能來自給定證據，不可捏造。若證據中有提供 URL，在 reasoning 中必須附上對應的 Markdown 來源連結（例如 [來源標題](URL)）。
- 每條主張用它的 index 回覆，證據也用同一個 index 對應。
- knowledgeBase 是使用者其他筆記，不是權威；與網路證據衝突時以可靠網路來源為準。
- 這是輔助判斷，不是最終權威。
- reasoning 與 suggestedFix 請以繁體中文 Markdown 撰寫，避免使用原始 HTML。
- reasoning 必須簡短精要（300 字以下），直接列出核心判定依據、證據限制與來源連結，避免冗言贅述。
- suggestedFix 必須簡練精確（300 字以下），直接提供可直接替換原主張的 Markdown 文字，不夾帶額外說明。

主張：
${JSON.stringify(claims)}

證據：
${JSON.stringify(evidence)}`
}

export function selfCheckPrompt(claim: string, verdict: unknown) {
  return `請用不同角度重判這條高信心的 contradicted 主張。若你不同意原判定，agree 設為 false。
主張：${claim}
原判定：${JSON.stringify(verdict)}`
}

export function graphPrompt(markdown: string) {
  return `從筆記抽出知識圖譜的實體與關係。
每個實體必須同時有繁體中文名稱 labelZh 與英文名稱 labelEn，aliases 放縮寫與符號（例如 F = ma）。
專有名詞的英文保留原文。關係使用穩定的英文 relation id，並提供 relationZh 與 relationEn。
同名但不同類的東西要分成不同實體，labelZh 要能區分（例如單位「牛頓 (單位)」與人物「艾薩克·牛頓」）；人名的別名不要放會和單位或概念撞名的簡稱。
relations 的 sourceZh 與 targetZh 必須逐字等於上面某個實體的 labelZh。
筆記中有明確關係的實體都要連起來，不要只列實體。
不要把整篇筆記當成一個節點。

筆記：
${markdown}`
}

export function matchPrompt(candidate: unknown, existing: unknown) {
  return `判斷候選實體是否與既有節點為同一事物。中英文寫法、別名與公式應視為同一實體的證據。
例如「牛頓第二定律」、「Newton's second law」與「F = ma」是同一實體。
只在很有把握時 same=true。

候選：${JSON.stringify(candidate)}
既有：${JSON.stringify(existing)}`
}
