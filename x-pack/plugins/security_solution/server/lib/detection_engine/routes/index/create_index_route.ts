/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { IRouter } from '../../../../../../../../src/core/server';
import { DETECTION_ENGINE_INDEX_URL } from '../../../../../common/constants';
import { transformError, buildSiemResponse } from '../utils';
import { getIndexExists } from '../../index/get_index_exists';
import { getPolicyExists } from '../../index/get_policy_exists';
import { setPolicy } from '../../index/set_policy';
import { setTemplate } from '../../index/set_template';
import { getSignalsTemplate } from './get_signals_template';
import { createBootstrapIndex } from '../../index/create_bootstrap_index';
import signalsPolicy from './signals_policy.json';
import { templateNeedsUpdate } from './check_template_version';

export const createIndexRoute = (router: IRouter) => {
  router.post(
    {
      path: DETECTION_ENGINE_INDEX_URL,
      validate: false,
      options: {
        tags: ['access:securitySolution'],
      },
    },
    async (context, request, response) => {
      const siemResponse = buildSiemResponse(response);

      try {
        const clusterClient = context.core.elasticsearch.legacy.client;
        const siemClient = context.securitySolution?.getAppClient();
        const callCluster = clusterClient.callAsCurrentUser;

        if (!siemClient) {
          return siemResponse.error({ statusCode: 404 });
        }

        const index = siemClient.getSignalsIndex();
        const indexExists = await getIndexExists(callCluster, index);
        if (await templateNeedsUpdate(callCluster, index)) {
          const policyExists = await getPolicyExists(callCluster, index);
          if (!policyExists) {
            await setPolicy(callCluster, index, signalsPolicy);
          }
          await setTemplate(callCluster, index, getSignalsTemplate(index));
          if (indexExists) {
            await callCluster('indices.rollover', { alias: index });
          }
        }
        if (!indexExists) {
          await createBootstrapIndex(callCluster, index);
        }
        return response.ok({ body: { acknowledged: true } });
      } catch (err) {
        const error = transformError(err);
        return siemResponse.error({
          body: error.message,
          statusCode: error.statusCode,
        });
      }
    }
  );
};
