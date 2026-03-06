import { useEffect, useState } from 'react';

// Custom hook that accepts a selector string as an argument
// and returns a boolean indicating whether the selected element is currently sticky.
export const useSticky = (selector: string): boolean => {
  const [isSticky, setIsSticky] = useState<boolean>(false);

  useEffect(() => {
    // Get element to observe
    const stickyElement = document.querySelector(selector);
    // Updates the sticky status based on the current position of the observed element.
    const observe = () => {
      // If the observed element is empty or not an instance of Element, return early.
      if (stickyElement == null || !(stickyElement instanceof Element)) return;

      // Calculate the element's offset from the top of the viewport and the value of its "top" CSS property.
      const elemOffset = stickyElement.getBoundingClientRect().top;
      const stickyOffset = parseInt(window.getComputedStyle(stickyElement).top);

      // Update the sticky status based on whether the element's offset is less than or equal to the sticky offset.
      setIsSticky(elemOffset <= stickyOffset);
    };
    // Call the observe function immediately and add it as a listener for scroll and resize events.
    observe();
    document.addEventListener('scroll', observe);
    window.addEventListener('resize', observe);

    // Remove the scroll and resize event listeners when the component unmounts or the selector value changes.
    return () => {
      document.removeEventListener('scroll', observe);
      window.removeEventListener('resize', observe);
    };
  }, [selector]);

  // Return the current sticky status.
  return isSticky;
};
