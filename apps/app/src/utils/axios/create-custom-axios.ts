/** biome-ignore-all lint/style/noRestrictedImports: This file provides a factory method for custom axios instance */
import type { AxiosRequestConfig } from 'axios';
import axios from 'axios';
import { formatISO } from 'date-fns';
import qs from 'qs';

import { convertStringsToDates } from './convert-strings-to-dates';

export const createCustomAxios = (config?: AxiosRequestConfig) => {
  const baseTransformers =
    axios.defaults.transformResponse == null
      ? []
      : Array.isArray(axios.defaults.transformResponse)
        ? axios.defaults.transformResponse
        : [axios.defaults.transformResponse];

  const customAxios = axios.create({
    ...config,

    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
    },

    transformResponse: baseTransformers.concat((data) => {
      return convertStringsToDates(data);
    }),
  });

  // serialize Date config: https://github.com/axios/axios/issues/1548#issuecomment-548306666
  customAxios.interceptors.request.use((config) => {
    config.paramsSerializer = (params) =>
      qs.stringify(params, {
        serializeDate: (date: Date) => {
          return formatISO(date, { representation: 'complete' });
        },
      });
    return config;
  });

  return customAxios;
};
