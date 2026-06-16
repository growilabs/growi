import commonStyles from './carbon-gray-common.puml';

const style = `
---
name: growi-carbon-gray-light
display_name: GROWI Carbon Gray
description: A gray theme using the IBM Carbon Design Gray palette for GROWI light themes
author: Yuki Takei
release:
license:
version:
source:
inspiration: https://carbondesignsystem.com/elements/color/overview/
---

!$THEME = "growi-carbon-gray-light"

'!$BGCOLOR = "#f5f5f5"

!if %not(%variable_exists("$BGCOLOR"))
!$BGCOLOR = "transparent"
!endif

skinparam backgroundColor $BGCOLOR
skinparam useBetaStyle false

!$RED_80 = '#750e13'
!$RED_70 = '#a2191f'
!$RED_60 = '#da1e28'
!$RED_50 = '#fa4d56'
!$RED_40 = '#ff8389'
!$RED_30 = '#ffb3b8'
!$RED_20 = '#ffd7d9'
!$RED_10 =  '#fff1f1'

!$CYAN_10 = '#e5f6ff'
!$CYAN_20 = '#bae6ff'
!$CYAN_30 = '#82cfff'
!$CYAN_40 = '#33b1ff'
!$CYAN_50 = '#1192e8'
!$CYAN_60 = '#0072c3'
!$CYAN_70 = '#00539a'
!$CYAN_80 = '#003a6d'


!$PURPLE_80 ='#491d8b'
!$PURPLE_70 = '#6929c4'
!$PURPLE_60 = '#8a3ffc'
!$PURPLE_50 = '#a56eff'
!$PURPLE_40 = '#be95ff'
!$PURPLE_30 = '#d4bbff'
!$PURPLE_20 = '#e8daff'
!$PURPLE_10 = '#f6f2ff'

!$TEAL_10 = '#d9fbfb'
!$TEAL_20 = '#9ef0f0'
!$TEAL_30 = '#3ddbd9'
!$TEAL_40 = '#08bdba'
!$TEAL_50 = '#009d9a'
!$TEAL_60 = '#007d79'
!$TEAL_70 = '#005d5d'
!$TEAL_80 = '#004144'

!$GRAY_10 = '#f4f4f4'
!$GRAY_20 = '#e0e0e0'
!$GRAY_30 = '#c6c6c6'
!$GRAY_40 = '#a8a8a8'
!$GRAY_50 = '#8d8d8d'
!$GRAY_60 = '#6f6f6f'
!$GRAY_70 = '#525252'
!$GRAY_80 = '#393939'
!$GRAY_90 = '#262626'
!$GRAY_100 = '#161616'
!$WHITE = '#FFFFF'

!$GRAY = $GRAY_30
!$LIGHT = $GRAY_70
!$DARK = $GRAY_90

'' *_LIGHT = tint (lighter) of the main color of 80%
''          where TINT is calculated by clr + (255-clr) * tint_factor
'' *_DARK = shade (darker) of the main color of 80%
''          and SHADE is calculated by clr * (1 - shade_factor)
''
!$FGCOLOR = $DARK
!$PRIMARY = $GRAY_10
!$PRIMARY_LIGHT = $GRAY_10
!$PRIMARY_DARK = $GRAY_30
!$PRIMARY_TEXT = $DARK
!$SECONDARY = $GRAY_10
!$SECONDARY_LIGHT = $GRAY_10
!$SECONDARY_DARK = $GRAY_30
!$SECONDARY_TEXT = $DARK
!$INFO = $WHITE
!$INFO_LIGHT = $GRAY_20
!$INFO_DARK = $GRAY_30
!$INFO_TEXT = $DARK
!$SUCCESS = $DARK
!$SUCCESS_LIGHT = $DARK
!$SUCCESS_DARK = $DARK
!$SUCCESS_TEXT = $WHITE
!$WARNING = $WHITE
!$WARNING_LIGHT = $WHITE
!$WARNING_DARK = $WHITE
!$WARNING_TEXT = $DARK
!$DANGER = $WHITE
!$DANGER_LIGHT = $WHITE
!$DANGER_DARK = $WHITE
!$DANGER_TEXT = $DARK

!$OTHER_BG = $WHITE
!$OTHER_TEXT = $WHITE
!$DB_BG = $GRAY

${commonStyles}
`;

export default style;
