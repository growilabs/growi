import { quoteForDisplay } from './quote-for-display';
import { IMAGE_TOKEN } from './rendered-text';

describe('quoteForDisplay', () => {
  it('shows a quote of only an image as [Image]', () => {
    expect(quoteForDisplay(IMAGE_TOKEN)).toBe('[Image]');
  });

  it('shows every image in a quote as [Image], keeping the text around them', () => {
    expect(
      quoteForDisplay(`START here ${IMAGE_TOKEN} middle ${IMAGE_TOKEN} END`),
    ).toBe('START here [Image] middle [Image] END');
  });

  it('leaves a quote without images unchanged', () => {
    expect(quoteForDisplay('plain text quote')).toBe('plain text quote');
  });
});
