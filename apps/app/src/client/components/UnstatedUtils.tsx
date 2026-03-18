import React from 'react';
import { type Container, Subscribe } from 'unstated';

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
export function withUnstatedContainers<
  ExternalProps extends Record<string, unknown>,
  InternalProps extends ExternalProps = ExternalProps,
>(
  Component: React.ComponentType<InternalProps>,
  containerClasses: (typeof Container)[],
): React.ForwardRefExoticComponent<
  React.PropsWithoutRef<ExternalProps> & React.RefAttributes<unknown>
> {
  const unstatedContainer = React.forwardRef<unknown, ExternalProps>(
    (props, ref) => (
      // wrap with <Subscribe></Subscribe>
      <Subscribe to={containerClasses}>
        {(...containers) => {
          // Container props are dynamically generated based on class names
          const propsForContainers = generateAutoNamedProps(containers) as Omit<
            InternalProps,
            keyof ExternalProps
          >;
          const mergedProps = {
            ...props,
            ...propsForContainers,
            ref,
          } as InternalProps & { ref: typeof ref };
          return <Component {...mergedProps} />;
        }}
      </Subscribe>
    ),
  );
  unstatedContainer.displayName = 'unstatedContainer';
  return unstatedContainer;
}
