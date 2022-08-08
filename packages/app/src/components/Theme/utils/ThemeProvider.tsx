
import React from 'react';

import dynamic from 'next/dynamic';

import { GrowiThemes } from '~/interfaces/theme';


const ThemeAntarctic = dynamic(() => import('../ThemeAntarctic'));
const ThemeBlackboard = dynamic(() => import('../ThemeBlackboard'));
const ThemeChristmas = dynamic(() => import('../ThemeChristmas'));
const ThemeDefault = dynamic(() => import('../ThemeDefault'));
const ThemeFireRed = dynamic(() => import('../ThemeFireRed'));
const ThemeFuture = dynamic(() => import('../ThemeFuture'));
const ThemeHalloween = dynamic(() => import('../ThemeHalloween'));
const ThemeHufflepuff = dynamic(() => import('../ThemeHufflepuff'));
const ThemeIsland = dynamic(() => import('../ThemeIsland'));
const ThemeJadeGreen = dynamic(() => import('../ThemeJadeGreen'));
const ThemeKibela = dynamic(() => import('../ThemeKibela'));
const ThemeMonoBlue = dynamic(() => import('../ThemeMonoBlue'));
const ThemeNature = dynamic(() => import('../ThemeNature'));
const ThemeSpring = dynamic(() => import('../ThemeSpring'));
const ThemeWood = dynamic(() => import('../ThemeWood'));


type Props = {
  children: JSX.Element,
  theme?: GrowiThemes,
}

export const ThemeProvider = ({ theme, children }: Props): JSX.Element => {
  switch (theme) {
    case GrowiThemes.ANTARCTIC:
      return <ThemeAntarctic>{children}</ThemeAntarctic>;
    case GrowiThemes.BLACKBOARD:
      return <ThemeBlackboard>{children}</ThemeBlackboard>;
    case GrowiThemes.CHRISTMAS:
      return <ThemeChristmas>{children}</ThemeChristmas>;
    case GrowiThemes.FIRE_RED:
      return <ThemeFireRed>{children}</ThemeFireRed>;
    case GrowiThemes.FUTURE:
      return <ThemeFuture>{children}</ThemeFuture>;
    case GrowiThemes.HALLOWEEN:
      return <ThemeHalloween>{children}</ThemeHalloween>;
    case GrowiThemes.HUFFLEPUFF:
      return <ThemeHufflepuff>{children}</ThemeHufflepuff>;
    case GrowiThemes.ISLAND:
      return <ThemeIsland>{children}</ThemeIsland>;
    case GrowiThemes.JADE_GREEN:
      return <ThemeJadeGreen>{children}</ThemeJadeGreen>;
    case GrowiThemes.KIBELA:
      return <ThemeKibela>{children}</ThemeKibela>;
    case GrowiThemes.MONO_BLUE:
      return <ThemeMonoBlue>{children}</ThemeMonoBlue>;
    case GrowiThemes.NATURE:
      return <ThemeNature>{children}</ThemeNature>;
    case GrowiThemes.SPRING:
      return <ThemeSpring>{children}</ThemeSpring>;
    case GrowiThemes.WOOD:
      return <ThemeWood>{children}</ThemeWood>;
    default:
      return <ThemeDefault>{children}</ThemeDefault>;
  }
};
