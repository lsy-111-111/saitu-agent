// Code-native technical-editorial cover system.
// Every visible element is inline SVG: no network requests, external images,
// gradients, random decoration, brand marks or competition names.

import {
  posterAigcMetadata,
  posterDate,
  POSTER_GENERATOR
} from "./poster-data.mjs";

const sceneDrawings = {
  "digital-media": `
    <g transform="translate(4 6)">
      <rect class="wash" x="32" y="32" width="248" height="154"/><rect class="s" x="32" y="32" width="248" height="154"/>
      <path class="h" d="M32 69h248M104 69v117"/><path class="h" d="M56 148l18-27 17 17 19-42 21 52 18-24 17 24 22-66 23 55 21-19 22 30"/>
      <g class="a"><rect x="321" y="43" width="36" height="36"/><rect x="361" y="43" width="18" height="18"/><rect x="383" y="43" width="27" height="27"/><rect x="321" y="83" width="20" height="20"/><rect x="345" y="83" width="41" height="41"/></g>
      <rect class="s" x="318" y="147" width="286" height="123"/><path class="h" d="M318 184h286M366 147v123M414 147v123M462 147v123M510 147v123M558 147v123"/>
      <path class="s" d="M108 258C212 229 270 307 388 268s170-143 288-164" marker-end="url(#arrow)"/>
      <path class="a" d="m681 97-17 39-14-12 9-44Z"/>
    </g>`,
  "three-dimensional": `
    <g transform="translate(20 -2)">
      <path class="wash" d="m218 50 128 72v144l-128 72-128-72V122Z"/><path class="s" d="m218 50 128 72v144l-128 72-128-72V122Zm0 0v144m128-72-128 72-128-72m128 72v144"/>
      <path class="h" d="m167 80 128 72v144M269 80 141 152v144"/>
      <path class="b" d="m397 69 130 73v145l-130-73Z"/><path class="s" d="m397 69 130 73v145l-130-73Z"/>
      <g class="a"><circle cx="397" cy="69" r="8"/><circle cx="527" cy="142" r="8"/><circle cx="527" cy="287" r="8"/><circle cx="397" cy="214" r="8"/></g>
      <path class="dim" d="M73 349h290m-290-12v24m290-24v24"/><path class="dim" d="M556 67v225m-12-225h24m-24 225h24"/>
    </g>`,
  "computer-design": `
    <g transform="translate(22 12)">
      <rect class="wash" x="32" y="24" width="562" height="251"/><rect class="s" x="32" y="24" width="562" height="251"/>
      <path class="h" d="M32 61h562M184 61v214M55 91h106M55 119h79M55 147h96"/>
      <path class="s" d="M224 221C270 87 370 267 533 91"/>
      <g class="a"><circle cx="224" cy="221" r="8"/><circle cx="533" cy="91" r="8"/><circle cx="326" cy="154" r="7"/><circle cx="431" cy="159" r="7"/></g>
      <path class="dim" d="M224 221v-72h102M533 91v72H431"/>
      <path class="s" d="M67 311h576"/><path class="h" d="M100 292v38M170 300v22M240 292v38M310 300v22M380 292v38M450 300v22M520 292v38M590 300v22"/>
      <rect class="a" x="369" y="296" width="89" height="30"/>
    </g>`,
  "industrial-design": `
    <g transform="translate(8 0)">
      <path class="wash" d="M63 53c75-29 188-28 257 2l-22 102c-11 50-50 79-102 79s-94-30-105-80Z"/>
      <path class="s" d="M63 53c75-29 188-28 257 2l-22 102c-11 50-50 79-102 79s-94-30-105-80Z"/>
      <path class="h" d="M83 95c65-25 159-24 218 2M92 143c60-20 140-20 199 0M196 34v224"/>
      <path class="s" d="M386 69h191v91H386Zm0 133h191v91H386Z"/><path class="h" d="M422 114h121M415 248c34-35 94-34 132 0"/>
      <g><rect class="a" x="610" y="69" width="58" height="58"/><rect class="b" x="610" y="141" width="58" height="58"/><rect class="hatch" x="610" y="213" width="58" height="58"/></g>
      <path class="dim" d="M50 280h275m-275-11v22m275-22v22"/>
    </g>`,
  "visual-design": `
    <g transform="translate(26 6)">
      <rect class="b mis" x="89" y="42" width="324" height="232"/><rect class="a" x="73" y="57" width="324" height="232" opacity=".72"/>
      <rect class="paper" x="121" y="88" width="228" height="170"/><path class="s" d="M48 77V35h42M379 35h42v42M48 269v42h42M379 311h42v-42"/>
      <g class="h">${Array.from({ length: 8 }, (_, row) => Array.from({ length: 12 }, (_, col) => `<circle cx="${468 + col * 17}" cy="${70 + row * 17}" r="${1.5 + row * .36}"/>`).join("")).join("")}</g>
      <path class="s" d="M481 244h191M481 274h133"/><path class="a" d="M508 199h81v20h-81Z"/>
      <path class="dim" d="M78 343h564m-564-13v26m564-26v26"/>
    </g>`,
  aircraft: `
    <g transform="translate(-8 5)">
      <path class="wash" d="M110 193c118-92 303-108 481-42-155 8-274 46-390 96-48 21-93-3-91-54Z"/>
      <path class="s" d="M110 193c118-92 303-108 481-42-155 8-274 46-390 96-48 21-93-3-91-54Z"/>
      <path class="h" d="M26 95c158-57 338-60 599-11M18 133c185-46 376-37 652 42M44 286c188 28 369-8 567-82M92 326c158 18 303-17 454-84" marker-end="url(#arrow)"/>
      <circle class="a" cx="349" cy="186" r="11"/><path class="dim" d="M349 186V55M335 55h28"/>
      <path class="b" d="m617 151 82 41-82 41Z"/>
    </g>`,
  "low-altitude": `
    <g transform="translate(0 3)">
      <path class="h" d="M23 79h650M23 143h650M23 207h650M23 271h650M23 335h650"/>
      <path class="s" d="M66 295 196 227l112 31 135-118 193 43" marker-end="url(#arrow)"/>
      <path class="b" d="M178 226 280 81l51 168Z" opacity=".28"/><path class="a" d="M424 140 510 31l55 135Z" opacity=".34"/>
      <g class="s"><circle cx="196" cy="227" r="14"/><circle cx="443" cy="140" r="14"/></g>
      <path class="dim" d="M44 79v256m-13-256h26m-26 256h26"/>
      <g class="h"><path d="M51 111h42M51 175h68M51 239h35M51 303h55"/></g>
    </g>`,
  mechanical: `
    <g transform="translate(18 2)">
      <path class="wash" d="M65 194c0-88 46-144 123-144 34 0 56 24 57 59 1 30 14 44 46 52 51 12 69 55 41 97-31 47-83 68-147 57-77-13-120-52-120-121Z"/>
      <path class="s" d="M65 194c0-88 46-144 123-144 34 0 56 24 57 59 1 30 14 44 46 52 51 12 69 55 41 97-31 47-83 68-147 57-77-13-120-52-120-121Z"/>
      <circle class="s" cx="187" cy="179" r="31"/><circle class="a" cx="187" cy="179" r="10"/>
      <path class="s" d="m214 195 139 80 103-147 154 66"/><g class="a"><circle cx="353" cy="275" r="12"/><circle cx="456" cy="128" r="12"/><circle cx="610" cy="194" r="12"/></g>
      <path class="dim" d="M371 248a93 93 0 0 1 66-96" marker-end="url(#arrow)"/>
      <path class="h" d="M45 341h615"/>
    </g>`,
  electronics: `
    <g transform="translate(11 4)">
      <rect class="wash" x="36" y="45" width="445" height="272"/><rect class="s" x="36" y="45" width="445" height="272"/>
      <path class="s" d="M75 97h76v63h86v-38h98v77h109M75 258h54v-47h132v67h99v-38h84"/>
      <g class="a"><circle cx="75" cy="97" r="9"/><circle cx="151" cy="160" r="9"/><circle cx="237" cy="122" r="9"/><circle cx="335" cy="199" r="9"/><circle cx="444" cy="199" r="9"/><circle cx="75" cy="258" r="9"/><circle cx="261" cy="278" r="9"/></g>
      <rect class="paper" x="510" y="77" width="172" height="173"/><rect class="s" x="510" y="77" width="172" height="173"/><path class="h" d="M530 167h29l17-58 29 109 23-73 16 22h20"/>
      <path class="h" d="M72 45V18M128 45V18M184 45V18M240 45V18M296 45V18M352 45V18M408 45V18"/>
    </g>`,
  "energy-efficiency": `
    <g transform="translate(12 8)">
      <path class="s" d="M29 82h126c54 0 68 51 116 51h88c60 0 82-78 141-78h170" stroke-width="24" opacity=".3"/>
      <path class="a" d="M29 189h151c44 0 51-31 92-31h97c55 0 63 55 116 55h185v28H485c-63 0-70-55-116-55h-97c-34 0-43 31-92 31H29Z" opacity=".75"/>
      <path class="b" d="M29 276h207c47 0 62-46 108-46h78c47 0 59 62 105 62h143v15H527c-58 0-70-62-105-62h-78c-38 0-53 46-108 46H29Z"/>
      <g class="s"><rect x="252" y="70" width="111" height="243"/><path d="M275 92h65v199M275 141h65M275 190h65M275 239h65"/></g>
      <path class="h" d="M493 44v286M512 76h142M512 110h93M512 144h124"/>
    </g>`,
  "integrated-circuit": `
    <g transform="translate(26 0)">
      <rect class="wash" x="37" y="32" width="349" height="294"/><rect class="s" x="37" y="32" width="349" height="294"/>
      <path class="s" d="M72 76h91v48h73v-27h112M72 171h52v-24h118v67h106M72 270h80v-34h73v41h123"/>
      <g class="a"><circle cx="163" cy="76" r="8"/><circle cx="236" cy="124" r="8"/><circle cx="124" cy="171" r="8"/><circle cx="242" cy="214" r="8"/><circle cx="152" cy="270" r="8"/><circle cx="225" cy="236" r="8"/></g>
      <path class="h" d="M428 62h245v56H428m0 43h245v56H428m0 43h245v56H428"/>
      <path class="b" d="M451 75h54v30h-54Zm92 99h78v30h-78Zm-62 99h109v30H481Z"/>
      <path class="dim" d="M411 32v294"/>
    </g>`,
  bim: `
    <g transform="translate(4 -3)">
      <path class="wash" d="m210 38 211 117v166L210 204 20 309V143Z"/><path class="s" d="m210 38 211 117v166L210 204 20 309V143Zm0 0v166m211-49L210 272 20 143m190 129v-68"/>
      <path class="h" d="m82 177 128-72 143 79v73l-143-79-128 72Zm64-36v73m128-73v73"/>
      <path class="b" d="m452 62 154 86v168l-154-86Z" opacity=".35"/><path class="s" d="m452 62 154 86v168l-154-86Z"/>
      <path class="dim" d="M20 342h401m-401-13v26m401-26v26M636 62v254"/>
    </g>`,
  manufacturing: `
    <g transform="translate(6 7)">
      <path class="h" d="M26 288h652M26 326h652"/>
      <g class="wash"><rect x="52" y="224" width="116" height="64"/><rect x="245" y="224" width="116" height="64"/><rect x="438" y="224" width="116" height="64"/></g>
      <g class="s"><rect x="52" y="224" width="116" height="64"/><rect x="245" y="224" width="116" height="64"/><rect x="438" y="224" width="116" height="64"/></g>
      <path class="s" d="M117 224v-63l88-52 63 39 94-93 69 30 47 139"/><g class="a"><circle cx="205" cy="109" r="13"/><circle cx="268" cy="148" r="13"/><circle cx="362" cy="55" r="13"/><circle cx="431" cy="85" r="13"/></g>
      <path class="dim" d="M58 351h110m77 0h116m77 0h116"/><path class="s" d="M581 74c71 42 71 132 0 174" marker-end="url(#arrow)"/>
      <path class="b" d="M602 102h48v109h-48Z"/>
    </g>`,
  iot: `
    <g transform="translate(0 0)">
      <path class="h" d="M91 92 270 56l140 91 183-73M91 92l64 171 255-116 111 137M270 56 155 263m255-116 111 137m72-210-72 210"/>
      <g class="wash"><circle cx="91" cy="92" r="41"/><circle cx="270" cy="56" r="28"/><circle cx="155" cy="263" r="35"/><circle cx="410" cy="147" r="48"/><circle cx="593" cy="74" r="31"/><circle cx="521" cy="284" r="39"/></g>
      <g class="s"><circle cx="91" cy="92" r="41"/><circle cx="270" cy="56" r="28"/><circle cx="155" cy="263" r="35"/><circle cx="410" cy="147" r="48"/><circle cx="593" cy="74" r="31"/><circle cx="521" cy="284" r="39"/></g>
      <rect class="a" x="378" y="115" width="64" height="64"/><path class="paper" d="M397 133h26v28h-26Z"/>
      <g class="b"><path d="m191 195 23-2-10 21ZM330 96l23 2-13 19ZM479 221l22 8-18 15Z"/></g>
    </g>`,
  challenge: `
    <g transform="translate(19 6)">
      <rect class="wash" x="31" y="32" width="225" height="286"/><rect class="s" x="31" y="32" width="225" height="286"/>
      <path class="h" d="M62 78h153M62 112h109M62 167h153M62 201h84M62 256h153"/><rect class="a" x="63" y="279" width="98" height="17"/>
      <g class="s"><rect x="310" y="48" width="272" height="207"/><path d="M310 100h272M378 48v207M446 48v207M514 48v207"/></g>
      <g class="b"><rect x="324" y="64" width="39" height="21"/><rect x="392" y="116" width="39" height="21"/><rect x="460" y="168" width="39" height="21"/><rect x="528" y="220" width="39" height="21"/></g>
      <path class="s" d="M284 321c77-67 141-39 188-81 52-47 85 6 181-76" marker-end="url(#arrow)"/>
    </g>`,
  "ai-pipeline": `
    <g transform="translate(4 7)">
      <g class="s"><rect x="24" y="51" width="143" height="98"/><rect x="24" y="187" width="143" height="98"/></g>
      <path class="h" d="M48 76h95M48 101h62M48 212h95M48 237h73"/>
      <path class="s" d="M167 100h71m-71 136h71M238 100v136" marker-end="url(#arrow)"/>
      <g class="wash"><rect x="238" y="66" width="204" height="205"/></g><rect class="s" x="238" y="66" width="204" height="205"/>
      <path class="s" d="M275 109h130M275 169h130M275 229h130"/><path class="b" d="M291 94h47v30h-47Zm74 60h27v30h-27Zm-62 60h77v30h-77Z"/>
      <path class="s" d="M442 168h73" marker-end="url(#arrow)"/>
      <g class="h"><path d="M535 266V72M535 266h140"/><path d="M557 229h19v37h-19Zm32-79h19v116h-19Zm32 42h19v74h-19Zm32-91h19v165h-19Z"/></g>
    </g>`,
  algorithm: `
    <g transform="translate(7 3)">
      <path class="h" d="m63 71 136 55 106-77 124 115 176-91M199 126l53 151m53-228 73 225m51-110 176 102"/>
      <g class="s"><circle cx="63" cy="71" r="27"/><circle cx="199" cy="126" r="33"/><circle cx="305" cy="49" r="25"/><circle cx="429" cy="164" r="38"/><circle cx="605" cy="73" r="29"/><circle cx="252" cy="277" r="25"/><circle cx="378" cy="274" r="25"/><circle cx="605" cy="266" r="29"/></g>
      <g class="a"><circle cx="63" cy="71" r="7"/><circle cx="199" cy="126" r="7"/><circle cx="305" cy="49" r="7"/><circle cx="429" cy="164" r="7"/></g>
      <g class="wash"><rect x="25" y="321" width="97" height="31"/><rect x="134" y="304" width="97" height="48"/><rect x="243" y="285" width="97" height="67"/><rect x="352" y="262" width="97" height="90"/></g>
      <path class="s" d="M476 336h174M476 306h130M476 276h92"/>
    </g>`,
  "smart-car": `
    <g transform="translate(-24 2)">
      <path class="s" d="M48 341C232 303 217 78 403 41s163 210 308 251" stroke-width="60" opacity=".18"/>
      <path class="h" d="M48 341C232 303 217 78 403 41s163 210 308 251" stroke-dasharray="18 20"/>
      <path class="s" d="M95 316c138-50 113-201 295-239s173 179 282 193" marker-end="url(#arrow)"/>
      <path class="b" d="M372 113 259 22l-35 161Z" opacity=".27"/><path class="a" d="M392 113 542 31l19 177Z" opacity=".28"/>
      <path class="wash" d="m342 96 31-51h74l42 51 22 9v43H321v-43Z"/><path class="s" d="m342 96 31-51h74l42 51 22 9v43H321v-43Z"/>
      <circle class="a" cx="367" cy="148" r="18"/><circle class="a" cx="466" cy="148" r="18"/>
      <path class="dim" d="M531 223a152 152 0 0 1 95 70" marker-end="url(#arrow)"/>
    </g>`,
  software: `
    <g transform="translate(0 3)">
      <g class="wash"><rect x="48" y="35" width="314" height="72"/><rect x="93" y="142" width="314" height="72"/><rect x="138" y="249" width="314" height="72"/></g>
      <g class="s"><rect x="48" y="35" width="314" height="72"/><rect x="93" y="142" width="314" height="72"/><rect x="138" y="249" width="314" height="72"/></g>
      <path class="h" d="M78 71h120M123 178h142M168 285h174"/>
      <path class="s" d="M362 71h84v107h-39m45 107h71V178h-116" marker-end="url(#arrow)"/>
      <g class="s"><rect x="523" y="49" width="146" height="270"/><path d="M523 103h146M523 157h146M523 211h146M523 265h146M571 49v270M620 49v270"/></g>
      <g class="a"><rect x="536" y="62" width="22" height="28"/><rect x="584" y="116" width="22" height="28"/><rect x="633" y="170" width="22" height="28"/></g>
    </g>`,
  security: `
    <g transform="translate(7 5)">
      <g class="wash"><rect x="25" y="35" width="185" height="283"/><rect x="256" y="35" width="185" height="283"/><rect x="487" y="35" width="185" height="283"/></g>
      <g class="s"><rect x="25" y="35" width="185" height="283"/><rect x="256" y="35" width="185" height="283"/><rect x="487" y="35" width="185" height="283"/></g>
      <path class="h" d="M57 81h121M57 126h87M57 171h121M57 216h67M57 261h121M288 81h121M288 126h87M288 171h121M519 81h121M519 126h87M519 171h121"/>
      <path class="s" d="M210 112h46m185 121h46" marker-end="url(#arrow)"/>
      <path class="a" d="m336 205 30 18-30 18-30-18Z"/><path class="b" d="m567 233 30 18-30 18-30-18Z"/>
      <path class="mis s" d="M72 297 283 67l107 167 239-121"/>
      <path class="a" d="m381 220 20 37-42-3Z"/>
    </g>`,
  computing: `
    <g transform="translate(0 4)">
      <g class="s">${Array.from({ length: 4 }, (_, row) => Array.from({ length: 7 }, (_, col) => `<rect x="${38 + col * 69}" y="${38 + row * 69}" width="48" height="48"/>`).join("")).join("")}</g>
      <g class="a"><rect x="176" y="107" width="48" height="48"/><rect x="314" y="176" width="48" height="48"/><rect x="107" y="245" width="48" height="48"/></g>
      <path class="s" d="M535 44h139v238H535Z"/><path class="h" d="M560 78h89M560 111h58M560 144h89M560 177h67M560 210h89"/>
      <path class="b" d="M535 305h139v35H535Z"/><path class="dim" d="M38 327h462"/>
    </g>`,
  robocon: `
    <g transform="translate(-6 -1)">
      <path class="h" d="M23 44h670v280H23Z M90 44v280M157 44v280M224 44v280M291 44v280M358 44v280M425 44v280M492 44v280M559 44v280M626 44v280M23 100h670M23 156h670M23 212h670M23 268h670"/>
      <path class="wash" d="M191 111h242v146H191Z"/><path class="s" d="M191 111h242v146H191Zm44 0V78h154v33M218 257v34m188-34v34"/>
      <circle class="a" cx="247" cy="181" r="20"/><circle class="a" cx="377" cy="181" r="20"/><path class="s" d="M270 223h85"/>
      <path class="s" d="M72 294C180 233 157 90 309 75s193 104 310 57" marker-end="url(#arrow)"/>
      <path class="b" d="M574 105h82v82h-82Z"/>
    </g>`,
  robocup: `
    <g transform="translate(-5 1)">
      <path class="h" d="M23 39h662v286H23ZM354 39v286M23 182h662M354 129a53 53 0 1 1 0 106 53 53 0 0 1 0-106Z"/>
      <g class="s"><circle cx="111" cy="94" r="23"/><circle cx="229" cy="142" r="23"/><circle cx="153" cy="262" r="23"/><circle cx="484" cy="103" r="23"/><circle cx="581" cy="187" r="23"/><circle cx="467" cy="270" r="23"/></g>
      <path class="s" d="m111 94 118 48-76 120m331-159 97 84-114 83"/>
      <path class="b" d="M111 94 260 47l-31 95Zm373 9 159-36-62 120Z" opacity=".25"/>
      <g class="a"><circle cx="273" cy="235" r="9"/><circle cx="424" cy="168" r="9"/></g>
      <path class="dim" d="M273 235 424 168" marker-end="url(#arrow)"/>
    </g>`,
  recursion: `
    <g transform="translate(10 5)">
      <path class="h" d="M82 52v55m0 0-49 54m49-54 49 54m-49-54 147 54m-196 0-13 72m13-72 44 72m54-72-34 72m34-72 42 72m56-72-20 72m20-72 43 72"/>
      <g class="s"><rect x="48" y="31" width="68" height="42"/><rect x="3" y="140" width="60" height="42"/><rect x="101" y="140" width="60" height="42"/><rect x="199" y="140" width="60" height="42"/><rect x="-10" y="232" width="60" height="42"/><rect x="59" y="232" width="60" height="42"/><rect x="129" y="232" width="60" height="42"/><rect x="198" y="232" width="60" height="42"/></g>
      <g class="wash"><rect x="313" y="38" width="157" height="57"/><rect x="346" y="117" width="157" height="57"/><rect x="379" y="196" width="157" height="57"/><rect x="412" y="275" width="157" height="57"/></g>
      <g class="s"><rect x="313" y="38" width="157" height="57"/><rect x="346" y="117" width="157" height="57"/><rect x="379" y="196" width="157" height="57"/><rect x="412" y="275" width="157" height="57"/></g>
      <g class="h"><path d="M596 54h91v91h-91Zm0 106h91v91h-91Zm0 106h91v66h-91Z"/></g><rect class="a" x="610" y="174" width="25" height="25"/>
    </g>`,
  vocational: `
    <g transform="translate(5 5)">
      <path class="h" d="M26 52h651M26 313h651"/>
      <g class="wash"><rect x="42" y="91" width="139" height="163"/><rect x="274" y="91" width="139" height="163"/><rect x="506" y="91" width="139" height="163"/></g>
      <g class="s"><rect x="42" y="91" width="139" height="163"/><rect x="274" y="91" width="139" height="163"/><rect x="506" y="91" width="139" height="163"/></g>
      <path class="s" d="M181 172h93m139 0h93" marker-end="url(#arrow)"/>
      <path class="h" d="M71 125h81M71 158h52M71 191h81M303 125h81M303 158h52M303 191h81M535 125h81M535 158h52M535 191h81"/>
      <g class="a"><rect x="92" y="218" width="39" height="20"/><rect x="324" y="218" width="39" height="20"/><rect x="556" y="218" width="39" height="20"/></g>
      <path class="dim" d="M42 287h603"/>
    </g>`,
  prototype: `
    <g transform="translate(2 7)">
      <rect class="s" x="30" y="76" width="133" height="174"/><path class="h" d="M58 111h77M58 145h52M58 179h77"/>
      <path class="s" d="M163 162h88" marker-end="url(#arrow)"/><path class="wash" d="m251 98 132-48 86 72-11 143-145 31-76-82Z"/><path class="s" d="m251 98 132-48 86 72-11 143-145 31-76-82Z"/>
      <path class="h" d="m313 296 70-246m-132 48 207 167"/><circle class="a" cx="355" cy="174" r="26"/>
      <path class="s" d="M469 163h77" marker-end="url(#arrow)"/><rect class="s" x="546" y="76" width="128" height="174"/>
      <path class="h" d="M571 111h78M571 145h52M571 179h78"/><rect class="b" x="576" y="211" width="68" height="17"/>
      <path class="dim" d="M583 289c-161 80-409 52-493-15" marker-end="url(#arrow)"/>
    </g>`,
  "green-lifecycle": `
    <g transform="translate(7 2)">
      <path class="s" d="M354 55c133 0 239 89 239 147s-106 147-239 147S115 260 115 202 221 55 354 55Z"/>
      <path class="s" d="M153 115 91 179l74 49M555 96l77 51-54 66M527 292l-70 58-42-73" marker-end="url(#arrow)"/>
      <g class="wash"><rect x="276" y="26" width="156" height="71"/><rect x="526" y="166" width="156" height="71"/><rect x="276" y="277" width="156" height="71"/><rect x="27" y="166" width="156" height="71"/></g>
      <g class="s"><rect x="276" y="26" width="156" height="71"/><rect x="526" y="166" width="156" height="71"/><rect x="276" y="277" width="156" height="71"/><rect x="27" y="166" width="156" height="71"/></g>
      <path class="h" d="M306 61h95M556 201h95M306 312h95M57 201h95"/>
      <g class="a"><rect x="314" y="111" width="80" height="18"/><rect x="441" y="193" width="80" height="18"/><rect x="314" y="244" width="80" height="18"/></g>
    </g>`,
  "innovation-matrix": `
    <g transform="translate(11 6)">
      <rect class="s" x="34" y="35" width="323" height="276"/><path class="h" d="M34 90h323M34 145h323M34 200h323M34 255h323M99 35v276M164 35v276M229 35v276M294 35v276"/>
      <g class="a"><rect x="111" y="101" width="41" height="33"/><rect x="176" y="156" width="41" height="33"/><rect x="241" y="211" width="41" height="33"/><rect x="306" y="266" width="41" height="33"/></g>
      <path class="s" d="M403 299h262M403 299v-51h52v-51h52v-51h52V95h52V44h54"/>
      <path class="h" d="m430 84 83 55 91-78m-174 23-8 118 91-63 104 75M513 139l-6 102"/>
      <g class="s"><circle cx="430" cy="84" r="19"/><circle cx="513" cy="139" r="19"/><circle cx="604" cy="61" r="19"/><circle cx="422" cy="202" r="19"/><circle cx="507" cy="241" r="19"/><circle cx="617" cy="214" r="19"/></g>
    </g>`,
  venture: `
    <g transform="translate(7 8)">
      <path class="h" d="M30 53h166v102H30Zm0 148h166v102H30Z"/><path class="h" d="M61 84h104M61 117h72M61 232h104M61 265h72"/>
      <path class="s" d="M196 104h70m-70 148h70" marker-end="url(#arrow)"/>
      <path class="wash" d="M266 53h175v250H266Z"/><path class="s" d="M266 53h175v250H266Z"/><path class="h" d="M294 91h119M294 132h88M294 173h119M294 214h88M294 255h119"/>
      <path class="s" d="M441 178h75" marker-end="url(#arrow)"/>
      <path class="s" d="M516 68h150v220H516Z"/><path class="h" d="M545 103h92M545 143h68M545 183h92M545 223h68"/>
      <path class="a" d="M545 255h92v17h-92Z"/>
      <path class="dim" d="M106 329h485"/>
    </g>`,
  ecommerce: `
    <g transform="translate(0 3)">
      <g class="s">${Array.from({ length: 3 }, (_, row) => Array.from({ length: 4 }, (_, col) => `<rect x="${27 + col * 70}" y="${45 + row * 70}" width="52" height="52"/>`).join("")).join("")}</g>
      <g class="a"><rect x="97" y="115" width="52" height="52"/><rect x="237" y="185" width="52" height="52"/></g>
      <path class="s" d="M335 49h220l-39 62H374l35 58h73l-37 62h-1l-36 64h73l-37 61"/>
      <path class="b" d="M374 111h142l-34 58h-73Zm35 58h73l-37 62h-1Z" opacity=".55"/>
      <path class="s" d="M516 231h58v59h99" marker-end="url(#arrow)"/>
      <path class="h" d="M574 263h42v-88h57M616 175v-70h57"/>
      <g class="a"><circle cx="673" cy="105" r="10"/><circle cx="673" cy="175" r="10"/><circle cx="673" cy="290" r="10"/></g>
    </g>`,
  career: `
    <g transform="translate(8 2)">
      <path class="h" d="m183 52 54 29 26 59-18 64-62 38-67-17-38-56 6-66 42-46Z"/>
      <path class="s" d="m183 90 26 30 2 48-37 31-46-14-16-39 19-37Z"/><path class="b" d="m183 90 26 30 2 48-37 31-46-14-16-39 19-37Z" opacity=".4"/>
      <path class="h" d="M183 52v190M78 169l185-29M126 57l119 147M84 103l161 101"/>
      <path class="s" d="M300 297c79-75 113-53 162-105 54-57 90-13 180-117" marker-end="url(#arrow)"/>
      <g class="wash"><circle cx="300" cy="297" r="26"/><circle cx="405" cy="228" r="26"/><circle cx="506" cy="156" r="26"/><circle cx="642" cy="75" r="26"/></g>
      <g class="s"><circle cx="300" cy="297" r="26"/><circle cx="405" cy="228" r="26"/><circle cx="506" cy="156" r="26"/><circle cx="642" cy="75" r="26"/></g>
    </g>`,
  "business-simulation": `
    <g transform="translate(3 6)">
      <path class="h" d="M31 315h654M31 41v274"/>
      <g class="wash"><rect x="70" y="228" width="55" height="87"/><rect x="159" y="169" width="55" height="146"/><rect x="248" y="201" width="55" height="114"/><rect x="337" y="105" width="55" height="210"/><rect x="426" y="137" width="55" height="178"/></g>
      <path class="s" d="m70 254 117-92 89 47 90-119 88 52 126-96"/>
      <g class="a"><circle cx="70" cy="254" r="9"/><circle cx="187" cy="162" r="9"/><circle cx="276" cy="209" r="9"/><circle cx="366" cy="90" r="9"/><circle cx="454" cy="142" r="9"/><circle cx="580" cy="46" r="9"/></g>
      <path class="b" d="M518 234c61-5 119 16 161 67l-21 14c-37-42-82-59-140-55Z"/>
      <path class="dim" d="M70 340h510"/>
    </g>`,
  "business-elite": `
    <g transform="translate(3 4)">
      <path class="h" d="M24 42h384v276H24Zm64 0v276m64-276v276m64-276v276m64-276v276m64-276v276M24 111h384M24 180h384M24 249h384"/>
      <path class="s" d="M55 286c35-129 144-31 174-145 24-92 103-65 151-77" marker-end="url(#arrow)"/>
      <g class="a"><circle cx="55" cy="286" r="9"/><circle cx="179" cy="201" r="9"/><circle cx="229" cy="141" r="9"/><circle cx="380" cy="64" r="9"/></g>
      <path class="s" d="M459 44h218l-39 68H498l35 61h70l-37 65h-1l-35 61h72"/>
      <path class="wash" d="M498 112h140l-35 61h-70Zm35 61h70l-37 65h-1Z"/>
      <path class="dim" d="M459 327h218"/>
    </g>`,
  "market-research": `
    <g transform="translate(11 5)">
      <rect class="s" x="25" y="39" width="333" height="277"/><path class="h" d="M25 94h333M25 149h333M25 204h333M25 259h333M91 39v277M157 39v277M223 39v277M289 39v277"/>
      <g class="a"><rect x="103" y="106" width="42" height="31"/><rect x="169" y="161" width="42" height="31"/><rect x="235" y="216" width="42" height="31"/><rect x="301" y="271" width="42" height="31"/></g>
      <path class="h" d="M407 316V39m0 277h273"/><g class="wash"><circle cx="451" cy="249" r="18"/><circle cx="483" cy="178" r="25"/><circle cx="527" cy="222" r="14"/><circle cx="565" cy="116" r="29"/><circle cx="611" cy="156" r="20"/><circle cx="650" cy="73" r="14"/></g>
      <path class="s" d="M431 276c86-9 139-71 226-220"/>
      <path class="dim" d="M407 337h273"/>
    </g>`,
  logistics: `
    <g transform="translate(-5 3)">
      <g class="s">${Array.from({ length: 3 }, (_, row) => Array.from({ length: 6 }, (_, col) => `<rect x="${30 + col * 78}" y="${43 + row * 78}" width="60" height="60"/>`).join("")).join("")}</g>
      <path class="s" d="M57 229h87v-96h155v78h161V73h117v156h110" marker-end="url(#arrow)"/>
      <g class="a"><circle cx="57" cy="229" r="10"/><circle cx="144" cy="133" r="10"/><circle cx="299" cy="211" r="10"/><circle cx="460" cy="73" r="10"/><circle cx="577" cy="229" r="10"/></g>
      <path class="h" d="M32 316h643M87 299v34M165 307v18M243 299v34M321 307v18M399 299v34M477 307v18M555 299v34M633 307v18"/>
      <rect class="b" x="509" y="120" width="60" height="60" opacity=".42"/>
    </g>`,
  fintech: `
    <g transform="translate(8 4)">
      <g class="wash"><rect x="26" y="52" width="203" height="83"/><rect x="90" y="156" width="203" height="83"/><rect x="154" y="260" width="203" height="83"/></g>
      <g class="s"><rect x="26" y="52" width="203" height="83"/><rect x="90" y="156" width="203" height="83"/><rect x="154" y="260" width="203" height="83"/></g>
      <path class="h" d="M57 92h141M121 196h141M185 300h141"/>
      <path class="h" d="M405 313V44m0 269h275"/><g class="a"><circle cx="444" cy="245" r="11"/><circle cx="481" cy="195" r="15"/><circle cx="527" cy="223" r="8"/><circle cx="562" cy="112" r="18"/><circle cx="610" cy="153" r="12"/><circle cx="653" cy="79" r="9"/></g>
      <path class="s" d="M410 273c93-28 155-99 261-223"/>
      <path class="b" d="M383 174h43v75h-43Z"/>
    </g>`,
  "academic-research": `
    <g transform="translate(8 5)">
      <rect class="wash" x="27" y="36" width="236" height="285"/><rect class="s" x="27" y="36" width="236" height="285"/>
      <path class="h" d="M59 78h171M59 111h122M59 166h171M59 199h93M59 254h171M59 287h136"/>
      <g class="a"><rect x="221" y="67" width="19" height="19"/><rect x="221" y="155" width="19" height="19"/><rect x="221" y="243" width="19" height="19"/></g>
      <path class="h" d="m315 91 95 54 87-86 142 84M410 145l17 126m70-212 36 206M315 91l12 199"/>
      <g class="s"><circle cx="315" cy="91" r="23"/><circle cx="410" cy="145" r="28"/><circle cx="497" cy="59" r="22"/><circle cx="639" cy="143" r="28"/><circle cx="327" cy="290" r="22"/><circle cx="427" cy="271" r="22"/><circle cx="533" cy="265" r="22"/></g>
      <path class="s" d="M313 334h328M373 319v30m207-30v30"/><rect class="b" x="430" y="321" width="94" height="26"/>
    </g>`,
  "math-modeling": `
    <g transform="translate(-4 3)">
      <g class="h"><path d="M28 315 212 33l235 54 221 228"/><path d="M62 315 229 64l199 48 199 203M103 315 248 98l161 39 174 178M151 315l115-183 124 30 146 153M207 315l78-148 87 20 115 128"/><path d="M28 315h640M64 259h565M101 203h486M138 147h405M175 91h326"/></g>
      <path class="s" d="M52 282c96-44 157-9 236-85 73-71 140-17 228-85 61-47 91-35 139-43" marker-end="url(#arrow)"/>
      <g class="a"><circle cx="52" cy="282" r="9"/><circle cx="288" cy="197" r="9"/><circle cx="516" cy="112" r="9"/><circle cx="655" cy="69" r="9"/></g>
      <path class="b" d="M92 333h22v18H92Zm36-4h22v22h-22Zm36 9h22v13h-22Zm36-16h22v29h-22Zm36 12h22v17h-22Z"/>
      <path class="dim" d="M334 341h312"/>
    </g>`,
  "energy-economics": `
    <g transform="translate(3 3)">
      <path class="h" d="M31 315h651M31 38v277M682 38v277"/>
      <g class="wash"><rect x="68" y="214" width="55" height="101"/><rect x="149" y="157" width="55" height="158"/><rect x="230" y="187" width="55" height="128"/><rect x="311" y="101" width="55" height="214"/></g>
      <path class="s" d="M60 273c102-40 184-123 313-162s190-33 289-77M60 74c122 40 181 114 307 149s197 33 295 68"/>
      <circle class="a" cx="396" cy="201" r="11"/><path class="dim" d="M396 201v121"/>
      <path class="s" d="M441 117h188m-188 39h128m-128 39h161"/>
      <path class="b" d="m589 234 75 38-75 38Z" opacity=".55"/>
    </g>`,
  translation: `
    <g transform="translate(0 3)">
      <rect class="wash" x="27" y="35" width="272" height="281"/><rect class="s" x="27" y="35" width="272" height="281"/>
      <rect class="wash" x="404" y="35" width="272" height="281"/><rect class="s" x="404" y="35" width="272" height="281"/>
      <path class="h" d="M60 77h204M60 112h149M60 147h204M60 182h171M60 217h204M60 252h132M437 77h204M437 112h149M437 147h204M437 182h171M437 217h204M437 252h132"/>
      <path class="s" d="M299 94h105m-105 70h105m-105 70h105" marker-end="url(#arrow)"/>
      <g class="a"><rect x="89" y="101" width="76" height="18"/><rect x="517" y="136" width="76" height="18"/><rect x="144" y="241" width="76" height="18"/></g>
      <path class="dim" d="M27 337h649"/>
    </g>`,
  speaking: `
    <g transform="translate(5 5)">
      <path class="h" d="M31 180h649M31 122h649M31 238h649"/>
      <path class="s" d="M31 180h36l17-66 21 128 25-89 19 27h39l18-43 24 87 27-132 29 88h41l20-37 24 67 25-103 31 73h49l22-51 29 92 31-146 34 105h56"/>
      <path class="a" d="M82 278h18v53H82Zm84-27h18v80h-18Zm84-49h18v129h-18Zm84 18h18v111h-18Zm84-72h18v183h-18Z" opacity=".72"/>
      <path class="s" d="M498 62h171v269H498Z"/><path class="h" d="M527 102h113M527 143h76M527 184h113M527 225h91M527 266h113"/>
      <path class="b" d="M527 292h83v18h-83Z"/>
      <path class="dim" d="M31 350h438"/>
    </g>`
};

const layoutTransforms = {
  "cut-left": "translate(-34 58) scale(1.06)",
  "cut-right": "translate(536 48) scale(1.05)",
  "axis-right": "translate(444 58) scale(1.02)",
  "rail-left": "translate(178 56) scale(1.03)",
  "full-field": "translate(284 58) scale(1.02)"
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function layoutFrame(entry) {
  const notation = escapeXml(entry.notation);
  const direction = escapeXml(entry.direction);

  if (entry.layout === "rail-left") {
    return `
      <path class="frame" d="M68 39v402M93 39v402"/>
      <text class="label" x="66" y="415" transform="rotate(-90 66 415)">${direction}</text>
      <text class="notation" x="112" y="78">${notation}</text>`;
  }
  if (entry.layout === "cut-left") {
    return `
      <path class="frame" d="M898 39v402M927 39v402M898 128h294M898 352h294"/>
      <text class="label" x="958" y="105">${direction}</text>
      <text class="notation" x="958" y="385">${notation}</text>`;
  }
  if (entry.layout === "cut-right") {
    return `
      <path class="frame" d="M351 39v402M322 39v402M88 128h263M88 352h263"/>
      <text class="label" x="88" y="105">${direction}</text>
      <text class="notation" x="88" y="385">${notation}</text>`;
  }
  if (entry.layout === "axis-right") {
    return `
      <path class="frame" d="M86 78h245M86 404h245M331 39v402"/>
      <text class="label" x="86" y="109">${direction}</text>
      <text class="notation" x="86" y="379">${notation}</text>
      <path class="dim" d="M119 153h178m-178 52h124m-124 52h155"/>`;
  }
  return `
    <path class="frame" d="M68 39v402M1212 39v402M68 82h1144M68 398h1144"/>
    <text class="label" x="92" y="71">${direction}</text>
    <text class="notation" x="1047" y="71">${notation}</text>`;
}

export function posterMetadata(entry) {
  return {
    id: entry.id,
    origin: "ai-generated",
    generator: POSTER_GENERATOR,
    generatedAt: posterDate(entry),
    semantic: entry.semantic,
    direction: entry.direction,
    externalAssets: false,
    officialIdentityUsed: false,
    humanAuthorshipClaimed: false,
    humanReviewStatus: "not-claimed",
    editorialReviewStatus: "assistant-reviewed-passed",
    editorialReviewedAt: posterDate(entry),
    implicitLabelStandard: "GB 45438-2025",
    implicitLabel: posterAigcMetadata(entry).AIGC
  };
}

export function renderPosterSvg(entry) {
  const [paper, ink, accent, secondary] = entry.palette;
  const drawing = sceneDrawings[entry.diagram] ?? sceneDrawings[entry.diagram.split("--", 1)[0]];
  const transform = layoutTransforms[entry.layout];
  if (!drawing || !transform) throw new Error(`Unknown diagram or layout for ${entry.id}`);
  const metadata = JSON.stringify(posterMetadata(entry)).replaceAll("]]>", "]]\\u003e");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="480" viewBox="0 0 1280 480" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(entry.semantic)}</title>
  <desc id="desc">Original technical-editorial competition illustration without official competition identity artwork.</desc>
  <metadata><![CDATA[${metadata}]]></metadata>
  <defs>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="${ink}" stroke-opacity=".065" stroke-width="1"/></pattern>
    <pattern id="fiber" width="73" height="47" patternUnits="userSpaceOnUse"><path d="m6 11 17-2m18 25 24 2M31 43l13-1" stroke="${ink}" stroke-width=".7" opacity=".08"/></pattern>
    <pattern id="hatching" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(12)"><path d="M0 0V9" stroke="${secondary}" stroke-width="3" opacity=".52"/></pattern>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="m0 0 9 5-9 5Z" fill="${accent}"/></marker>
    <clipPath id="artboard"><rect width="1280" height="480"/></clipPath>
  </defs>
  <style>
    .s{fill:none;stroke:${ink};stroke-width:4.2;stroke-linecap:square;stroke-linejoin:miter}
    .h{fill:none;stroke:${ink};stroke-width:2;stroke-linecap:square;stroke-linejoin:miter;opacity:.72}
    .dim{fill:none;stroke:${accent};stroke-width:2;stroke-dasharray:8 7;opacity:.86}
    .a{fill:${accent}}.b{fill:${secondary}}.wash{fill:${accent};opacity:.14}.paper{fill:${paper}}.hatch{fill:url(#hatching)}
    .mis{transform:translate(3px,-2px);opacity:.38}.frame{fill:none;stroke:${ink};stroke-width:1.5;opacity:.36}
    .label,.notation{font-family:Arial,"Noto Sans SC",sans-serif;font-size:15px;font-weight:700;letter-spacing:2.3px;fill:${ink};opacity:.72}
    .notation{font-size:13px;fill:${accent};opacity:1}
  </style>
  <rect width="1280" height="480" fill="${paper}"/>
  <rect width="1280" height="480" fill="url(#fiber)"/>
  <rect width="1280" height="480" fill="url(#grid)"/>
  <g clip-path="url(#artboard)">
    <path d="M-50 422 351 18" stroke="${secondary}" stroke-width="36" opacity=".07"/>
    <path d="m1038 506 292-294" stroke="${accent}" stroke-width="20" opacity=".08"/>
    ${layoutFrame(entry)}
    <g transform="${transform}">${drawing}</g>
    <g opacity=".5"><path class="s" d="M31 31h22M42 20v22M1227 449h22M1238 438v22"/></g>
  </g>
</svg>`;
}

export function renderPosterHtml(entry) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:1280px;height:480px;overflow:hidden}svg{display:block}</style></head><body>${renderPosterSvg(entry)}</body></html>`;
}
