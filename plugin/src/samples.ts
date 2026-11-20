// Three sample portraits for the zero state, drawn by the portrait rules (PORTRAIT_PROMPT). Static and ours: shown as <img>, so nothing in them runs.
export const SAMPLE_PORTRAITS: readonly string[] = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img">
<title>Dex</title>
<defs><clipPath id="dex-clip"><circle cx="128" cy="128" r="128"/></clipPath></defs>
<circle cx="128" cy="128" r="128" fill="#3b7dd8"/>
<g clip-path="url(#dex-clip)">
<path d="M34 256 C38 214 64 192 100 186 L156 186 C192 192 218 214 222 256 Z" fill="#3c4049"/>
<path d="M84 196 C84 176 172 176 172 196 C166 212 90 212 84 196 Z" fill="#2c2f36"/>
<path d="M110 150 L146 150 L148 194 C138 202 118 202 108 194 Z" fill="#d9a684"/>
<path d="M100 190 C112 204 144 204 156 190 L164 198 C148 216 108 216 92 198 Z" fill="#4a4f59"/>
<path d="M118 208 L116 230 M138 208 L140 230" stroke="#e4e4e4" stroke-width="4" stroke-linecap="round" fill="none"/>
<ellipse cx="77" cy="118" rx="11" ry="15" fill="#e6b08c"/>
<ellipse cx="179" cy="118" rx="11" ry="15" fill="#e6b08c"/>
<path d="M78 104 C78 64 100 48 128 48 C156 48 178 64 178 104 L178 132 C178 160 156 178 128 178 C100 178 78 160 78 132 Z" fill="#f0c3a0"/>
<path d="M80 130 C82 162 104 178 128 178 C152 178 174 162 176 130 C168 142 158 146 148 144 C140 140 116 140 108 144 C98 146 88 142 80 130 Z" fill="#8d9298" opacity="0.45"/>
<path d="M76 106 C70 60 96 36 128 36 C160 36 186 60 180 106 L172 106 C172 90 170 76 164 68 C150 72 140 78 128 78 C116 78 106 72 92 68 C86 76 84 90 84 106 Z" fill="#b8bcc2"/>
<path d="M108 86 Q128 82 148 86" stroke="#dca889" stroke-width="3" stroke-linecap="round" fill="none"/>
<path d="M92 98 Q106 90 120 96 M136 96 Q150 90 164 98" stroke="#8a8e94" stroke-width="7" stroke-linecap="round" fill="none"/>
<ellipse cx="106" cy="114" rx="11" ry="11" fill="#fff"/>
<ellipse cx="150" cy="114" rx="11" ry="11" fill="#fff"/>
<circle cx="107" cy="115" r="7" fill="#2a1d18"/>
<circle cx="151" cy="115" r="7" fill="#2a1d18"/>
<circle cx="109.5" cy="112.5" r="2.5" fill="#fff"/>
<circle cx="153.5" cy="112.5" r="2.5" fill="#fff"/>
<path d="M88 108 L82 105 M88 118 L82 121 M168 108 L174 105 M168 118 L174 121 M98 128 Q106 132 114 128 M142 128 Q150 132 158 128" stroke="#c08f70" stroke-width="3" stroke-linecap="round" fill="none"/>
<path d="M128 118 Q120 134 132 136" stroke="#c9926f" stroke-width="5" stroke-linecap="round" fill="none"/>
<path d="M112 152 Q128 162 146 150" stroke="#5a2e24" stroke-width="6" stroke-linecap="round" fill="none"/>
<rect x="44" y="218" width="168" height="48" rx="9" fill="#e9e1c9"/>
<rect x="44" y="218" width="168" height="8" rx="4" fill="#f6f1e2"/>
<g fill="#c4b894">
<rect x="98" y="232" width="16" height="11" rx="2"/>
<rect x="118" y="232" width="16" height="11" rx="2"/>
<rect x="138" y="232" width="16" height="11" rx="2"/>
<rect x="56" y="232" width="14" height="11" rx="2"/>
<rect x="186" y="232" width="14" height="11" rx="2"/>
<rect x="66" y="248" width="16" height="11" rx="2"/>
<rect x="86" y="248" width="84" height="11" rx="2"/>
<rect x="174" y="248" width="16" height="11" rx="2"/>
</g>
<rect x="158" y="232" width="16" height="11" rx="2" fill="#d9534f"/>
<path d="M72 220 C72 204 96 204 96 220 L96 232 C96 238 72 238 72 232 Z" fill="#f0c3a0"/>
<path d="M160 220 C160 204 184 204 184 220 L184 232 C184 238 160 238 160 232 Z" fill="#f0c3a0"/>
<path d="M80 222 L80 234 M88 222 L88 234 M168 222 L168 234 M176 222 L176 234" stroke="#d29c78" stroke-width="3" stroke-linecap="round"/>
</g>
</svg>`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img">
<title>Lea</title>
<defs><clipPath id="lea-clip"><circle cx="128" cy="128" r="128"/></clipPath></defs>
<circle cx="128" cy="128" r="128" fill="#f2c14e"/>
<g clip-path="url(#lea-clip)">
<path d="M166 46 C200 34 218 66 210 104 C204 132 190 144 180 156 C186 124 186 92 166 70 Z" fill="#b5532c"/>
<circle cx="170" cy="54" r="8" fill="#e94f6b"/>
<path d="M38 256 C42 214 66 194 102 188 L154 188 C190 194 214 214 218 256 Z" fill="#5b86c9"/>
<path d="M110 150 L146 150 L148 196 C138 204 118 204 108 196 Z" fill="#e8bba0"/>
<path d="M104 190 L128 214 L152 190 Z" fill="#fff"/>
<path d="M102 188 L92 206 L118 222 L128 214 Z M154 188 L164 206 L138 222 L128 214 Z" fill="#4a72b0"/>
<ellipse cx="76" cy="122" rx="10" ry="14" fill="#f0c6aa"/>
<ellipse cx="180" cy="122" rx="10" ry="14" fill="#f0c6aa"/>
<ellipse cx="128" cy="116" rx="54" ry="58" fill="#f8dcc8"/>
<path d="M74 110 C68 54 100 34 130 34 C162 34 188 56 182 108 C178 90 172 78 162 72 C150 84 118 86 98 76 C88 82 80 94 74 110 Z" fill="#b5532c"/>
<path d="M92 100 Q104 92 116 98 M140 98 Q152 92 164 100" stroke="#8a3d20" stroke-width="5" stroke-linecap="round" fill="none"/>
<ellipse cx="106" cy="118" rx="12" ry="13" fill="#fff"/>
<ellipse cx="150" cy="118" rx="12" ry="13" fill="#fff"/>
<circle cx="107" cy="119" r="8" fill="#2a1d18"/>
<circle cx="151" cy="119" r="8" fill="#2a1d18"/>
<circle cx="110" cy="116" r="3" fill="#fff"/>
<circle cx="154" cy="116" r="3" fill="#fff"/>
<ellipse cx="92" cy="140" rx="9" ry="6" fill="#f08a8a" opacity="0.4"/>
<ellipse cx="164" cy="140" rx="9" ry="6" fill="#f08a8a" opacity="0.4"/>
<g fill="#c98a64">
<circle cx="102" cy="136" r="2.5"/><circle cx="110" cy="140" r="2.5"/><circle cx="96" cy="142" r="2.5"/>
<circle cx="154" cy="136" r="2.5"/><circle cx="146" cy="140" r="2.5"/><circle cx="160" cy="142" r="2.5"/>
</g>
<path d="M125 132 Q128 137 132 134" stroke="#d99a7c" stroke-width="4" stroke-linecap="round" fill="none"/>
<path d="M114 150 Q128 158 142 150 Q138 162 128 162 Q118 162 114 150 Z" fill="#7a2e2a"/>
<path d="M117 151 Q128 155 139 151 L138 154 Q128 157 118 154 Z" fill="#fff"/>
<rect x="46" y="168" width="44" height="74" rx="8" fill="#26282e"/>
<rect x="51" y="175" width="34" height="58" rx="4" fill="#8fd6ff"/>
<rect x="56" y="190" width="11" height="11" fill="#e94f6b"/>
<rect x="69" y="190" width="11" height="11" fill="#b5532c"/>
<rect x="56" y="203" width="11" height="11" fill="#5b86c9"/>
<rect x="69" y="203" width="11" height="11" fill="#f2c14e"/>
<rect x="34" y="244" width="70" height="20" rx="6" fill="#4a72b0"/>
<path d="M42 222 C40 248 96 252 96 222 L96 214 C96 208 88 208 88 214 L88 228 L50 228 L50 214 C50 208 42 208 42 214 Z" fill="#f8dcc8"/>
<rect x="84" y="196" width="12" height="30" rx="6" fill="#f8dcc8"/>
<rect x="40" y="198" width="11" height="12" rx="5.5" fill="#f8dcc8"/>
<rect x="40" y="211" width="11" height="12" rx="5.5" fill="#f8dcc8"/>
</g>
</svg>`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img">
<title>Sam</title>
<defs><clipPath id="sam-clip"><circle cx="128" cy="128" r="128"/></clipPath></defs>
<circle cx="128" cy="128" r="128" fill="#4caf6e"/>
<g clip-path="url(#sam-clip)">
<path d="M38 256 C42 214 66 194 102 188 L154 188 C190 194 214 214 218 256 Z" fill="#3b2f5c"/>
<path d="M110 150 L146 150 L148 196 C138 204 118 204 108 196 Z" fill="#a8714a"/>
<ellipse cx="77" cy="120" rx="10" ry="14" fill="#b67e54"/>
<ellipse cx="179" cy="120" rx="10" ry="14" fill="#b67e54"/>
<ellipse cx="128" cy="114" rx="52" ry="60" fill="#c48a5c"/>
<path d="M74 112 C66 60 94 34 126 32 C152 30 186 46 184 108 C180 94 176 86 170 80 C162 86 150 80 146 72 C136 82 112 86 100 76 C94 86 82 94 74 112 Z" fill="#3a2618"/>
<path d="M92 99 L118 97 M138 97 L164 99" stroke="#3a2618" stroke-width="6" stroke-linecap="round" fill="none"/>
<ellipse cx="106" cy="116" rx="11" ry="12" fill="#fff"/>
<ellipse cx="150" cy="116" rx="11" ry="12" fill="#fff"/>
<circle cx="107" cy="117" r="7.5" fill="#2a1d18"/>
<circle cx="151" cy="117" r="7.5" fill="#2a1d18"/>
<circle cx="109.5" cy="114.5" r="2.5" fill="#fff"/>
<circle cx="153.5" cy="114.5" r="2.5" fill="#fff"/>
<rect x="88" y="102" width="36" height="28" rx="6" fill="none" stroke="#1c1c1c" stroke-width="5"/>
<rect x="132" y="102" width="36" height="28" rx="6" fill="none" stroke="#1c1c1c" stroke-width="5"/>
<path d="M124 112 L132 112 M88 110 L78 108 M168 110 L178 108" stroke="#1c1c1c" stroke-width="5" stroke-linecap="round"/>
<path d="M128 122 Q122 136 132 138" stroke="#a06a42" stroke-width="5" stroke-linecap="round" fill="none"/>
<path d="M114 154 Q126 160 142 152" stroke="#4a1f1a" stroke-width="6" stroke-linecap="round" fill="none"/>
<path d="M72 236 L184 236 L198 250 L58 250 Z" fill="#9aa0aa"/>
<rect x="70" y="174" width="116" height="64" rx="7" fill="#b9bec7"/>
<rect x="78" y="182" width="100" height="48" rx="3" fill="#121a16"/>
<g fill="#5df08a">
<rect x="86" y="190" width="44" height="7" rx="2"/>
<rect x="86" y="203" width="64" height="7" rx="2"/>
<rect x="86" y="216" width="22" height="7" rx="2"/>
<rect x="114" y="214" width="9" height="11"/>
</g>
<rect x="58" y="196" width="18" height="36" rx="9" fill="#c48a5c"/>
<rect x="180" y="196" width="18" height="36" rx="9" fill="#c48a5c"/>
</g>
</svg>`,
]
