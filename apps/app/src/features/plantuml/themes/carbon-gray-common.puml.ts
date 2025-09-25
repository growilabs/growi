/**
 * ---
 * name: growi-carbon-gray
 * display_name: GROWI Carbon Gray
 * description: A gray theme using the IBM Carbon Design Gray palette for GROWI
 * author: Yuki Takei
 * release:
 * license:
 * version:
 * source:
 * inspiration: https://carbondesignsystem.com/elements/color/overview/
 * ---
 */
const style = `
!$LINE_THICKNESS = 1
!$BORDER_THICKNESS = 1

!procedure $success($msg)
  <font color=$SUCCESS><b>$msg
!endprocedure

!procedure $failure($msg)
  <font color=$DANGER><b>$msg
!endprocedure

!procedure $warning($msg)
  <font color=$WARNING><b>$msg
!endprocedure

!procedure $primary_scheme()
	FontColor $PRIMARY_TEXT
	BorderColor $PRIMARY_DARK
	BackgroundColor $PRIMARY_LIGHT-$PRIMARY
	RoundCorner 0
!endprocedure

''
'' Global Default Values
''
skinparam defaultFontName        "IBM Plex Sans, Noto Sans, Verdana"
skinparam defaultFontSize        12
'skinparam dpi                    125
skinparam shadowing              false
skinparam roundcorner            0
skinparam ParticipantPadding     30
skinparam BoxPadding             30
skinparam Padding                10
skinparam ArrowColor             $GRAY
skinparam stereotype {
    CBackgroundColor $SECONDARY_LIGHT
    CBorderColor $SECONDARY_DARK
    ABackgroundColor $SUCCESS_LIGHT
    ABorderColor $SUCCESS_DARK
    IBackgroundColor $DANGER_LIGHT
    IBorderColor $DANGER_DARK
    EBackgroundColor $WARNING_LIGHT
    EBorderColor $WARNING_DARK
    NBackgroundColor $INFO_LIGHT
    NBorderColor $INFO_DARK
}
skinparam title {
	FontColor	                 $SECONDARY_TEXT
	BorderColor	                 $SECONDARY
	FontSize	    	         20
	BorderRoundCorner            8
	BorderThickness 	         0
	BackgroundColor              $BGCOLOR
}


skinparam legend {
	BackgroundColor $OTHER_BG
	BorderColor $DARK
	FontColor $PRIMARY_TEXT
}

!startsub swimlane
skinparam swimlane {
	BorderColor $PRIMARY
	BorderThickness $LINE_THICKNESS
	TitleBackgroundColor  $PRIMARY_LIGHT-$PRIMARY
	TitleFontColor $PRIMARY_TEXT
	BackgroundColor $BG_COLOR
	TitleFontStyle bold
}
!endsub

!startsub activity

skinparam activity {
	$primary_scheme()
	BarColor $DARK
	StartColor $LIGHT-$DARK
	EndColor $LIGHT-$DARK
	''
	DiamondBackgroundColor $SECONDARY_LIGHT-$SECONDARY
  	DiamondBorderColor $SECONDARY
	DiamondFontColor $SECONDARY_TEXT
}
!endsub

!startsub participant

skinparam participant {
	$primary_scheme()
	ParticipantBorderThickness $BORDER_THICKNESS
}
!endsub

!startsub actor

skinparam actor {
	FontColor $PRIMARY_TEXT
	BorderColor $GRAY_50
	BackgroundColor $PRIMARY
	RoundCorner 0
}
!endsub

!startsub arrow

skinparam arrow {
	Thickness $LINE_THICKNESS
	Color $GRAY
	FontColor $FGCOLOR
}
!endsub

!startsub sequence

skinparam sequence {
	BorderColor $PRIMARY_DARK
	' For some reason sequence title font color does not pick up from global
	TitleFontColor $SECONDARY_TEXT
	BackgroundColor $OTHER_BG
	StartColor $PRIMARY
	EndColor $PRIMARY
	''
	BoxBackgroundColor $OTHER_BG
	BoxBorderColor $PRIMARY_DARK
	BoxFontColor $PRIMARY_TEXT
	''
	DelayFontColor $PRIMARY_TEXT
	''
	LifeLineBorderColor $PRIMARY_DARK
	LifeLineBorderThickness $LINE_THICKNESS
	LifeLineBackgroundColor $PRIMARY
	''
	GroupBorderColor $PRIMARY_DARK
	GroupFontColor $PRIMARY_TEXT
	GroupFontStyle bold
	GroupHeaderFontColor $INFO_TEXT
	GroupBackgroundColor $PRIMARY
	GroupBodyBackgroundColor $OTHER_BG
	GroupHeaderBackgroundColor $PRIMARY
	''
	DividerBackgroundColor $PRIMARY
    DividerBorderColor $PRIMARY_DARK
    DividerBorderThickness $LINE_THICKNESS
    DividerFontColor $PRIMARY_TEXT
	''
	ReferenceBackgroundColor $BGCOLOR
	ReferenceHeaderBorderColor $PRIMARY_DARK
	ReferenceHeaderBackgroundColor $PRIMARY
	ReferenceBorderColor $PRIMARY_DARK
	ReferenceFontColor $DARK
	ReferenceHeaderFontColor $INFO_TEXT
	''
	StereotypeFontColor $PRIMARY_TEXT
}
!endsub

!startsub partition

skinparam partition {
	BorderColor $PRIMARY
	FontColor $PRIMARY_TEXT
	BackgroundColor $OTHER_BG
	fontStyle bold
}
!endsub

!startsub collections

skinparam collections {
	$primary_scheme()
}
!endsub

!startsub control

skinparam control {
	$primary_scheme()
}
!endsub

!startsub entity

skinparam entity {
	$primary_scheme()
}
!endsub

!startsub boundary

skinparam boundary {
	$primary_scheme()
}
!endsub

!startsub agent

skinparam agent {
	BackgroundColor $PRIMARY_LIGHT
	BorderColor $PRIMARY_DARK
	FontColor $PRIMARY_TEXT
	RoundCorner 0
}
!endsub

!startsub note

skinparam note {
	BorderThickness 1
	BackgroundColor $INFO_LIGHT-$INFO
	BorderColor $DARK
	FontColor $INFO_TEXT
	RoundCorner 0
}
!endsub

!startsub artifact

skinparam artifact {
	BackgroundColor $PRIMARY
	BorderColor $PRIMARY_DARK
	FontColor $DARK
	RoundCorner 0
}
!endsub

!startsub component

skinparam component {
	$primary_scheme()
	BackgroundColor $PRIMARY
	BorderColor $PRIMARY_DARK
}
!endsub

!startsub interface

skinparam interface {
	BackgroundColor  $PRIMARY_DARK
	BorderColor  $PRIMARY_DARK
	FontColor $PRIMARY_TEXT
}
!endsub

!startsub storage

skinparam storage {
	BackgroundColor $OTHER_BG
  	BorderColor $DARK
	FontColor $WARNING_TEXT
}
!endsub

!startsub node

skinparam node {
	BackgroundColor $OTHER_BG
	BorderColor $PRIMARY_DARK
	FontColor $PRIMARY_TEXT
	Roundcorner 0
}
!endsub

!startsub cloud

skinparam cloud {
	BackgroundColor $OTHER_BG
	BorderColor $PRIMARY_DARK
	FontColor $PRIMARY_TEXT
	Roundcorner 0
}
!endsub

!startsub database

skinparam database {
	$primary_scheme()
	BorderColor $PRIMARY_DARK
	BackgroundColor  $OTHER_BG
	Roundcorner 0
}
!endsub

!startsub class

skinparam class {
	$primary_scheme()
	HeaderBackgroundColor $PRIMARY_LIGHT-$PRIMARY
	StereotypeFontColor $PRIMARY_TEXT
	StereotypeFontSize 9
	BorderThickness $LINE_THICKNESS
	AttributeFontColor $PRIMARY_TEXT
	AttributeFontSize 11
}
!endsub

!startsub object

skinparam object {
	$primary_scheme()
	StereotypeFontColor $PRIMARY_TEXT
	BorderThickness $BORDER_THICKNESS
	AttributeFontColor $PRIMARY_TEXT
	AttributeFontSize 11
}
!endsub

!startsub usecase

skinparam usecase {
	$primary_scheme()
	BorderThickness $BORDER_THICKNESS
	StereotypeFontColor $PRIMARY_TEXT
}
!endsub

!startsub rectangle

skinparam rectangle {
	$primary_scheme()
	BackgroundColor $OTHER_BG
	BorderThickness $BORDER_THICKNESS
	StereotypeFontColor $PRIMARY_TEXT
}
!endsub

!startsub package

skinparam package {
	$primary_scheme()
	BackgroundColor $OTHER_BG
	BorderThickness $BORDER_THICKNESS
}
!endsub

!startsub folder

skinparam folder {
	BackgroundColor $OTHER_BG
  	BorderColor $PRIMARY_DARK
	FontColor $WARNING_TEXT
	BorderThickness $BORDER_THICKNESS
	Roundcorner 0
}
!endsub

!startsub frame

skinparam frame {
	BackgroundColor $OTHER_BG
  	BorderColor $PRIMARY_DARK
	FontColor $DARK
	BorderThickness $BORDER_THICKNESS
	Roundcorner 0
}
!endsub

!startsub state

skinparam state {
	$primary_scheme()
	BorderColor $PRIMARY_DARK
	StartColor $INFO
	EndColor $INFO
	AttributeFontColor $SECONDARY_TEXT
	AttributeFontSize 11
}
!endsub

!startsub queue

skinparam queue {
	$primary_scheme()

}
!endsub

!startsub card

skinparam card {
	BackgroundColor $OTHER_BG
	BorderColor $PRIMARY_DARK
	FontColor $INFO_TEXT
	RoundCorner 0
}
!endsub

!startsub file

skinparam file {
	BackgroundColor $SECONDARY_LIGHT-$SECONDARY
	BorderColor $SECONDARY_DARK
	FontColor $SECONDARY_TEXT
	RoundCorner 0

}
!endsub

!startsub stack

skinparam stack {
	$primary_scheme()
}
!endsub

!startsub person

skinparam person {
	$primary_scheme()
}
!endsub


!if (%variable_exists("LEGACY"))
!$LEGACY = "true"
!endif

!if (%getenv("LEGACY") == "true")
!$LEGACY = "true"
!endif

'!if (not %variable_exists("$LEGACY"))

skinparam useBetaStyle true

!startsub mindmap

<style>

boardDiagram {
	node {
	$primary_scheme()
    BackGroundColor  $PRIMARY
    LineColor $PRIMARY_DARK
    FontName "IBM Plex Sans, Noto Sans, Verdana"
    'FontColor
    FontSize 12
    'FontStyle bold
    RoundCorner 0
    'LineThickness 2
    'LineStyle 10-5
    separator {
      LineThickness $LINE_THICKNESS
      LineColor $PRIMARY_DARK
      'LineStyle 1-5
    }
  }
}

ganttDiagram {

  task {
    BackGroundColor $PRIMARY
    LineColor $PRIMARY_DARK
	FontStyle Bold
	FontSize 12
    unstarted {
      BackGroundColor $PRIMARY_LIGHT
      LineColor $PRIMARY_DARK
	  'FontColor $RED_80
    }
	Padding 3
	Margin 3

  }
  timeline {
	LineColor $PRIMARY
	FontColor !$OTHER_TEXT
	BackgroundColor $DARK
    FontName Helvetica
    'FontSize 12
    FontStyle bold
	YearFontColor !$OTHER_TEXT
	QuarterFontColor !$OTHER_TEXT
	MonthFontColor !$OTHER_TEXT
	WeekFontColor !$OTHER_TEXT
	WeekdayFontColor !$OTHER_TEXT
	DayFontColor !$OTHER_TEXT
  }
  arrow {
		'FontName Helvetica
		'FontColor red
		FontSize 12
		FontStyle bold
		'BackGroundColor GreenYellow
		LineColor $PRIMARY_DARK
		'LineStyle 8.0-13.0
		'LineThickness 3.0
	}

  milestone {
		FontColor $PRIMARY_TEXT
		FontSize 12
		FontStyle  bold
		BackGroundColor $DARK
		LineColor $DARK
	}
  separator {
		BackgroundColor $PRIMARY
		'LineStyle 8.0-3.0
		LineColor $PRIMARY
		LineThickness 1.0
		FontSize 12
		FontStyle bold
		FontColor  $PRIMARY_TEXT
		Margin 3
		'Padding 20
	}
	closed {
		BackgroundColor $RED_20
		FontColor $RED_20
	}
}

jsonDiagram {
  node {
	$primary_scheme()
    BackGroundColor  $PRIMARY
    LineColor $PRIMARY_DARK
    FontName "IBM Plex Sans, Noto Sans, Verdana"
    'FontColor
    FontSize 12
    'FontStyle bold
    RoundCorner 0
    'LineThickness 2
    'LineStyle 10-5
    separator {
      LineThickness $LINE_THICKNESS
      LineColor $PRIMARY_DARK
      'LineStyle 1-5
    }
  }
  arrow {
    BackGroundColor $PRIMARY_DARK
    LineColor $PRIMARY_DARK
    LineThickness $LINE_THICKNESS
    LineStyle 3-6
  }
  highlight {
    BackGroundColor $PRIMARY_DARK
    FontColor $PRIMARY_TEXT
    FontStyle italic
  }
}


mindmapDiagram {
  'Padding 8
  'Margin 8
  LineThickness $LINE_THICKNESS
  FontColor $PRIMARY_TEXT
  LineColor $PRIMARY_DARK
  'BackgroundColor $PRIMARY_LIGHT-$PRIMARY
  Roundcorner 0
  node {
    'Padding 12
    'Margin 3
    'HorizontalAlignment center
    LineColor $PRIMARY_DARK
    LineThickness $BORDER_THICKNESS
    BackgroundColor $PRIMARY_LIGHT-$PRIMARY
    RoundCorner 0
    MaximumWidth 100
	FontColor $DARK
	'FontStyle bold
  }
}

'Salt Diagram only has limited skinning
saltDiagram {
  BackGroundColor $BG_COLOR
  'Fontname Monospaced
  'FontSize 10
  'FontStyle italic
  'LineThickness 0.5
  'LineColor PRIMARY_DARK
}

timingDiagram {
  document {
    BackGroundColor $BG_COLOR
	LineColor $PRIMARY
	BorderColor $PRIMARY
	FontColor $PRIMARY_TEXT

  }
  highlight {
	 BackGroundColor $PRIMARY
  }

 constraintArrow {
  'LineStyle 2-1
  LineThickness 2
  LineColor $RED_80
  FontColor $RED_80
  FontStyle bold
 }
}

wbsDiagram {
  'Padding 8
  node {
    'Padding 12
    'Margin 3
    'HorizontalAlignment center
    LineColor $PRIMARY_DARK
    LineThickness $BORDER_THICKNESS
    BackgroundColor $PRIMARY_LIGHT-$PRIMARY
    RoundCorner 0
    MaximumWidth 100
	FontColor $PRIMARY_TEXT
	'FontStyle bold
  }
  'Margin 8
  'LineThickness $LINE_THICKNESS
  'FontColor $PRIMARY_TEXT
  'LineColor $PRIMARY
  'BorderColor $PRIMARY
  'BackgroundColor $PRIMARY_LIGHT-$PRIMARY
  'RoundCorner 0

  arrow {
	' note that Connectors are actually "Arrows"; this may change in the future
	' so this means all Connectors and Arrows are now going to be green

    lineColor $PRIMARY_DARK
    fontColor $PRIMARY_TEXT
    thickness $LINE_THICKNESS
  }

  noteBorderColor $DARK
}

'Placeholder for adding wirediagram skins
wireDiagram {
}

yamlDiagram {
  node {
	$primary_scheme()
    BackGroundColor  $PRIMARY
    LineColor $PRIMARY_DARK
    FontName "IBM Plex Sans, Noto Sans, Verdana"
    'FontColor
    FontSize 12
    'FontStyle bold
    RoundCorner 0
    'LineThickness 2
    'LineStyle 10-5
    separator {
      LineThickness $LINE_THICKNESS
      LineColor $PRIMARY_DARK
      'LineStyle 1-5
    }
  }
  arrow {
    BackGroundColor $PRIMARY_DARK
    LineColor $PRIMARY_DARK
    LineThickness $LINE_THICKNESS
    LineStyle 3-6
  }
  highlight {
    BackGroundColor $PRIMARY_DARK
    FontColor $PRIMARY_TEXT
    FontStyle italic
  }
}
</style>
!endsub
'!endif
`;

export default style;
