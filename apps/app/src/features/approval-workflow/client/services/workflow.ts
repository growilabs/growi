import { useState, useCallback, useMemo } from 'react';

import { apiv3Delete } from '~/client/util/apiv3-client';

import {
  WorkflowApprovalType,
  WorkflowApproverStatus,
  type EditingApproverGroup,
  type IWorkflowApproverGroupHasId,
} from '../../interfaces/workflow';

export const deleteWorkflow = async(workflowId: string): Promise<void> => {
  await apiv3Delete(`/workflow/${workflowId}`);
};


// see: https://robinpokorny.medium.com/index-as-a-key-is-an-anti-pattern-e0349aece318
// When rendering with maps, without a unique key, unintended behavior can occur.
const generateEmptyApproverGroup = (): EditingApproverGroup => {
  return {
    approvalType: WorkflowApprovalType.AND,
    approvers: [],
    uuidForRenderList: crypto.randomUUID(),
  };
};

const setUUIDtoApproverGroups = (approverGroups: IWorkflowApproverGroupHasId[]): EditingApproverGroup[] => {
  return approverGroups.map((g) => { return { ...g, uuidForRenderList: crypto.randomUUID() } });
};

const getAllApproverIds = (approverGroups: EditingApproverGroup[]): string[] => {
  const userIds: string[] = [];
  approverGroups.forEach((group) => {
    const ids = group.approvers.map((approver) => { return approver.user._id });
    userIds.push(...ids);
  });
  return userIds;
};

const getAllApprovedApproverIds = (approverGroups: EditingApproverGroup[]): string[] => {
  const userIds: string[] = [];
  approverGroups.forEach((group) => {
    const ids = group.approvers
      .filter(approver => approver.status === WorkflowApproverStatus.APPROVE)
      .map(approver => approver.user._id);
    userIds.push(...ids);
  });

  return userIds;
};

type UseEditingApproverGroups = {
  editingApproverGroups: EditingApproverGroup[]
  allEditingApproverIds: string[]
  allApprovedApproverIds?: string[]
  updateApproverGroupHandler: (groupIndex: number, updateApproverGroupData: EditingApproverGroup) => void
  addApproverGroupHandler: (groupIndex: number) => void
  removeApproverGroupHandler: (groupIndex: number) => void
}

export const useEditingApproverGroups = (initialData?: IWorkflowApproverGroupHasId[]): UseEditingApproverGroups => {
  const initialApproverGroupData = initialData != null ? setUUIDtoApproverGroups(initialData) : [generateEmptyApproverGroup()];
  const [editingApproverGroups, setEditingApproverGroups] = useState<EditingApproverGroup[]>(initialApproverGroupData);

  const allEditingApproverIds = useMemo(() => getAllApproverIds(editingApproverGroups), [editingApproverGroups]);

  const allApprovedApproverIds = useMemo(() => {
    return initialData != null ? getAllApprovedApproverIds(editingApproverGroups) : undefined;
  }, [editingApproverGroups, initialData]);

  const updateApproverGroupHandler = useCallback((groupIndex: number, updateApproverGroupData: EditingApproverGroup) => {
    const clonedApproverGroups = [...editingApproverGroups];
    clonedApproverGroups[groupIndex] = updateApproverGroupData;
    setEditingApproverGroups(clonedApproverGroups);
  }, [editingApproverGroups]);

  const addApproverGroupHandler = useCallback((groupIndex: number) => {
    const clonedApproverGroups = [...editingApproverGroups];
    clonedApproverGroups.splice(groupIndex, 0, generateEmptyApproverGroup());
    setEditingApproverGroups(clonedApproverGroups);
  }, [editingApproverGroups]);

  const removeApproverGroupHandler = useCallback((groupIndex: number) => {
    const clonedApproverGroups = [...editingApproverGroups];
    clonedApproverGroups.splice(groupIndex, 1);
    setEditingApproverGroups(clonedApproverGroups);
  }, [editingApproverGroups]);

  return {
    editingApproverGroups,
    allEditingApproverIds,
    allApprovedApproverIds,
    updateApproverGroupHandler,
    addApproverGroupHandler,
    removeApproverGroupHandler,
  };
};
