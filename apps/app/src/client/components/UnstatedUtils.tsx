import React from 'react';
import { Subscribe } from 'unstated';

/**
 * generate K/V object by specified instances
 *
 * @param {Array<object>} instances
 * @returns automatically named key and value
 *   e.g.
 *   {
 *     appContainer: <AppContainer />,
 *     exampleContainer: <ExampleContainer />,
 *   }
 */

function generateAutoNamedProps(instances) {
  const props = {};

  instances.forEach((instance) => {
    // get class name
    const className = instance.constructor.getClassName();
    // convert initial charactor to lower case
    const propName = `${className.charAt(0).toLowerCase()}${className.slice(1)}`;

    props[propName] = instance;
  });

  return props;
}

/**
 * Return a React component that is injected unstated containers
 *
 * @param {object} Component A React.Component or functional component
 * @param {array} containerClasses unstated container classes to subscribe
 * @returns returns such like a following element:
 *  e.g.
 *  <Subscribe to={containerClasses}>  // containerClasses = [AppContainer, PageContainer]
 *    { (appContainer, pageContainer) => (
 *      <Component appContainer={appContainer} pageContainer={pageContainer} {...this.props} />
 *    )}
 *  </Subscribe>
 */
export function withUnstatedContainers<T, P>(
  Component,
  containerClasses,
): React.ForwardRefExoticComponent<
  React.PropsWithoutRef<P> & React.RefAttributes<T>
> {
  const unstatedContainer = React.forwardRef<T, P>((props, ref) => (
    // wrap with <Subscribe></Subscribe>
    <Subscribe to={containerClasses}>
      {(...containers) => {
        const propsForContainers = generateAutoNamedProps(containers);
        return <Component {...props} {...propsForContainers} ref={ref} />;
      }}
    </Subscribe>
  ));
  unstatedContainer.displayName = 'unstatedContainer';
  return unstatedContainer;
}
