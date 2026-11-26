# magpie-agent-uebox

鎶?[UEBox锛堣櫄骞荤洅瀛愶級](https://github.com/ueboxai/uebox) 浣滀负 Agent 鎺ュ叆 [magpie](https://github.com/yetone/magpie)锛氬湪 magpie 鐨?Agents 椤垫墦寮€寮€鍏筹紝UEBox 灏辩敤涓?magpie 鐨勫叏閮ㄦā鍨嬨€佸璐﹀彿銆佹晠闅滃垏鎹㈠拰鐢ㄩ噺缁熻銆?
Put [UEBox](https://github.com/ueboxai/uebox) on [magpie](https://github.com/yetone/magpie)'s gateway: UEBox appears as an agent on magpie's Agents page, and its models come from magpie.

> 涓€涓?magpie 鐨?**Agent 鎻掍欢**锛坄magpie.agent`锛夈€俇EBox 涓?magpie 鍧囬潪鏈粨搴撳嚭鍝侊紱杩欓噷鍙槸涓よ€呬箣闂寸殑鎺ョ嚎銆?
## 瀹冩€庝箞宸ヤ綔 / How it works

UEBox 鐨勬湇鍔″晢閰嶇疆鏄?`%APPDATA%\unreal-box\models.json`锛坢acOS / Linux 瑙佷笅锛夛紝鍏朵腑 `providers` 鏄?*鏁扮粍**銆俶agpie 鐨?Agent 鎻掍欢鍙兘鎸夐敭璺緞鍐欓厤缃紝鍐欐暟缁勪細鎶婃暣娈垫浛鎹㈡帀锛屾墍浠ヨ繖涓彃浠跺垎涓ら儴鍒嗭細

| 閮ㄥ垎 | 璺戝湪鍝?| 骞蹭粈涔?|
| --- | --- | --- |
| `uebox.agent.js` | magpie 杩涚▼鍐咃紙moejs锛屾棤 Node锛?| 澹版槑 Agent 閭ｄ竴琛岋紱鎵撳紑寮€鍏虫椂鎶婄綉鍏冲湴鍧€銆佽繖鎶?Agent 涓撶敤鐨?key 鍜?magpie 褰撳墠鐨勬ā鍨嬪垪琛ㄥ啓杩?`~/.config/magpie/uebox-link.json` |
| `index.mjs` + `lib/sync.mjs` | magpie 鐨勬彃浠跺涓伙紙Bun锛屾湁 fs锛?| 鐩戝惉涓婇潰閭ｄ釜鏂囦欢锛屾妸涓€涓?id 涓?`magpie` 鐨勬湇鍔″晢鍚堝苟杩?`models.json`锛涘叧鎺夊紑鍏虫椂鍙垹鎺夎繖涓€椤?|

`providers` 閲屼綘鑷繁鐨勬湇鍔″晢銆乣roles` 閲岀殑榛樿妯″瀷缁戝畾閮戒笉浼氳鍔紱棣栨鏀瑰姩鍓嶄細鎶婂師鏂囦欢澶囦唤鎴?`models.json.magpie-backup`锛堝彧澶囦唤涓€娆★級锛屽啓鍏ョ敤涓存椂鏂囦欢 + rename锛岄伩鍏嶅崐涓枃浠躲€?
鏈嶅姟鍟嗗崗璁敤 **`openai-responses`**锛宍baseUrl` 鏄?`<缃戝叧>/v1`銆傝繖涓嶆槸闅忎究閫夌殑锛歎EBox 搴曞眰鐨?pi-ai 鍙湪 Responses 杩欐潯璺笂鍙戜細璇濇爣璇嗭紙`session-id` 澶达級锛岃蛋 `openai-completions` 鏃?magpie 鐨勮矾鐢遍〉浼氭妸姣忔潯璇锋眰閮藉綊鍒般€屾湭鎻愪緵浼氳瘽鏍囪瘑銆嶏紝涓€涓璇濈殑澶氳疆鏁ｆ垚涓€鍫嗗崟杞€?
瀵嗛挜鐢?UEBox 鐨?`shell` 寮曠敤锛坄echo magpie-uebox`锛夛紝鏄庢枃 key 涓嶈惤杩?`models.json` 鈥斺€?UEBox 鏈潵灏卞彧鍦ㄨ繖涓枃浠堕噷瀛樺瘑閽ュ紩鐢紝瀵嗘枃鍙﹀瓨銆?
## 瀹夎 / Install

```sh
magpie plugin add github:wjf990711/magpie-agent-uebox
```

鐩綍鏂瑰紡涔熷彲浠ワ紙鏀瑰畬涓嶇敤閲嶈锛宮agpie 姣忕妫€鏌ヤ竴娆℃枃浠跺彉鍖栵級锛?
```sh
git clone https://github.com/wjf990711/magpie-agent-uebox
magpie plugin add ./magpie-agent-uebox
```

鐒跺悗鍦?magpie 鐨?**Agents** 椤电粰 UEBox 閫変竴涓ā鍨嬶紙鎴?`magpie uebox magpie`锛夛紝鍐嶅洖鍒?UEBox **璁剧疆 鈫?妯″瀷**锛屾妸銆岄粯璁ゆā鍨?鈫?瀵硅瘽銆嶆寚鍚?`magpie` 涓嬬殑妯″瀷銆?
UEBox 浼氱紦瀛?`models.json`锛氭墦寮€涓€娆¤缃〉鎴栭噸鍚?UEBox 鎵嶄細璇诲埌鏂板唴瀹广€?
鍏抽棴锛歚magpie uebox default`锛屾垨鎶?Agents 椤甸偅涓€琛岀殑寮€鍏冲叧鎺夛紝`models.json` 鎭㈠鍘熸牱銆?
## 鏀寔鐨勭郴缁?/ Platforms

| 绯荤粺 | UEBox 鏁版嵁鐩綍 |
| --- | --- |
| Windows | `%APPDATA%\unreal-box\` |
| macOS | `~/Library/Application Support/unreal-box/` |
| Linux | `~/.config/unreal-box/` |

UEBox 鑷繁鐩墠浠?Windows 涓洪瑕佸钩鍙帮紱杩欎釜鎻掍欢鍙槸璇诲啓閰嶇疆鏂囦欢锛屼笉闄愮郴缁熴€傝矾寰勫彲浠ョ敤鐜鍙橀噺 `UEBOX_USER_DATA` 瑕嗙洊锛堟祴璇曠敤锛夈€?
## 宸茬煡杈圭晫 / Limitations

- 鍙湪 **UEBox 鍚姩鏃?*璇绘ā鍨嬮厤缃紝鏀逛簡瑕侀噸鍚垨鎵撳紑璁剧疆椤点€?- 鎻掍欢鍙啓 `providers` 閲岀殑 `magpie` 涓€椤癸紝**涓嶇** `roles`锛氶粯璁ゆā鍨嬩粛鐢变綘鍦?UEBox 閲岄€夈€?- UEBox 鍦ㄨ缃〉淇濆瓨鏃朵細鏁翠綋閲嶅啓 `models.json`锛屼絾浼氫繚鐣?`shell` 瀵嗛挜寮曠敤锛屾墍浠ヤ笉浼氫涪鎺ュ叆锛涙彃浠朵篃浼氬湪鍑犵鍐呮妸 `magpie` 杩欎竴椤硅ˉ鍥炲幓銆?- 鐢ㄩ噺璁板湪 magpie 鐨?`uebox` 鍚嶄笅锛屽拰鍏朵粬 Agent 涓€鏍峰彲鍦?magpie 鐨勭敤閲忛〉鎸変細璇濇煡鐪嬨€?
## 寮€鍙?/ Development

```sh
npm test          # node --test锛? 椤癸紝鍏ㄩ儴鍦ㄤ复鏃剁洰褰曢噷璺戯紝涓嶇鐪熷疄閰嶇疆
```

`lib/sync.mjs` 閲岀殑 `merge()` 鏄函鍑芥暟锛氱粰涓€浠?`models.json` 鍜屼竴浠?link 鏂囦欢锛岃繑鍥炲悎骞跺悗鐨勭粨鏋滐紝娴嬭瘯灏辨槸鍥寸潃瀹冭浆鐨勩€?
## 璁稿彲 / License

MIT銆俇EBox 鏄?Apache-2.0锛宮agpie 鏄?MIT銆俇EBox 鍥炬爣鍙栬嚜 `ueboxai/uebox` 浠撳簱鐨?`build/icon.svg`锛屼粎鐢ㄤ簬鍦?magpie 閲屾爣璇嗚繖涓?Agent銆?