import React, { useState, useCallback } from 'react';

import { useTranslation } from 'next-i18next';
import { ModalBody, ModalFooter } from 'reactstrap';

import {
  type IWorkflowHasId,
  type WorkflowApprovalType,
  type EditingApproverGroup,
  type CreateApproverGroupData,
  type UpdateApproverGroupData,
} from '~/features/approval-workflow/interfaces/workflow';

import { getLatestApprovedApproverGroupIndex } from '../../../utils/workflow';
import { useEditingApproverGroups } from '../../services/workflow';
import { useSWRxWorkflow } from '../../stores/workflow';

import { EditableApproverGroupCards } from './EditableApproverGroupCards';
import { WorkflowForm } from './WorkflowForm';
import { WorkflowModalHeader } from './WorkflowModalHeader';


// Compare oldUserIds and newUserIds and extract the userId that has increased or decreased
const compareApproverDiff = (oldUserIds: string[], newUserIds: string[]): { userIdToAdd?: string, userIdToRemove?: string } => {
  const userIdToAdd = newUserIds.find(item => !oldUserIds.includes(item));
  const userIdToRemove = oldUserIds.find(item => !newUserIds.includes(item));
  return { userIdToAdd, userIdToRemove };
};

type Props = {
  workflow: IWorkflowHasId
  onUpdated?: () => void
  onClickWorkflowDetailPageBackButton: () => void
}

export const WorkflowEditModalContent = (props: Props): JSX.Element => {
  const { t } = useTranslation();

  const { workflow, onUpdated, onClickWorkflowDetailPageBackButton } = props;

  const {
    editingApproverGroups,
    allEditingApproverIds,
    allApprovedApproverIds,
    updateApproverGroupHandler,
    addApproverGroupHandler,
    removeApproverGroupHandler,
  } = useEditingApproverGroups(workflow.approverGroups);

  const { update: updateWorkflow } = useSWRxWorkflow(workflow?._id);

  const latestApprovedApproverGroupIndex = getLatestApprovedApproverGroupIndex(workflow);
  const excludedSearchUserIds = [workflow.creator._id, ...allEditingApproverIds];

  const [editingWorkflowName, setEditingWorkflowName] = useState<string | undefined>(workflow.name);
  const [editingWorkflowDescription, setEditingWorkflowDescription] = useState<string | undefined>(workflow.comment);
  const [updateApproverGroupData, setUpdateApproverGroupData] = useState<Array<UpdateApproverGroupData & { uuidForRender?: string }>>([]);

  const workflowNameChangeHandler = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setEditingWorkflowName(event.target.value);
  }, []);

  const workflowDescriptionChangeHandler = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditingWorkflowDescription(event.target.value);
  }, []);

  const createRequestDataForCreate = useCallback((editingApproverGroups: EditingApproverGroup[]): CreateApproverGroupData[] => {
    const createApproverGroupData: CreateApproverGroupData[] = [];
    const notInDBApproverGroups = editingApproverGroups.filter(v => v._id == null);

    notInDBApproverGroups.forEach((notInDBApproverGroup) => {
      const groupIndex = editingApproverGroups
        .findIndex(editingApproverGroup => editingApproverGroup.uuidForRenderList === notInDBApproverGroup.uuidForRenderList);
      createApproverGroupData.push({
        groupIndex,
        approvalType: notInDBApproverGroup.approvalType,
        userIdsToAdd: notInDBApproverGroup.approvers.map(v => v.user._id),
      });
    });

    return createApproverGroupData;
  }, []);

  const createRequestDataForUpdate = useCallback((
      groupId: string,
      uuidForRender: string,
      approvalType: WorkflowApprovalType,
      userIdToAdd?: string,
      userIdToRemove?: string,
  ) => {
    const clonedUpdateApproverGroupData = [...updateApproverGroupData];
    const targetUpdateApproverGroupData = clonedUpdateApproverGroupData.find(v => uuidForRender === v.uuidForRender);

    if (targetUpdateApproverGroupData != null) {
      targetUpdateApproverGroupData.approvalType = approvalType;

      if (userIdToAdd != null && !targetUpdateApproverGroupData.userIdsToAdd?.includes(userIdToAdd)) {
        targetUpdateApproverGroupData.userIdsToAdd?.push(userIdToAdd);

        const removeIndex = targetUpdateApproverGroupData.userIdsToRemove?.indexOf(userIdToAdd);
        if (removeIndex != null && removeIndex >= 0) targetUpdateApproverGroupData.userIdsToRemove?.splice(removeIndex, 1);
      }

      if (userIdToRemove != null && !targetUpdateApproverGroupData.userIdsToRemove?.includes(userIdToRemove)) {
        targetUpdateApproverGroupData.userIdsToRemove?.push(userIdToRemove);

        const removeIndex = targetUpdateApproverGroupData.userIdsToAdd?.indexOf(userIdToRemove);
        if (removeIndex != null && removeIndex >= 0) targetUpdateApproverGroupData.userIdsToAdd?.splice(removeIndex, 1);
      }
      setUpdateApproverGroupData(clonedUpdateApproverGroupData);
    }
    else {
      const newData = {
        groupId,
        uuidForRender,
        approvalType,
        userIdsToAdd: userIdToAdd != null ? [userIdToAdd] : [],
        userIdsToRemove: userIdToRemove != null ? [userIdToRemove] : [],
      };
      setUpdateApproverGroupData([...updateApproverGroupData, newData]);
    }
  }, [updateApproverGroupData]);

  const onUpdateApproverGroupsHandler = useCallback((groupIndex: number, approverGroup: EditingApproverGroup) => {
    const oldUserIds = editingApproverGroups[groupIndex].approvers.map(v => v.user._id);
    const newUserIds = approverGroup.approvers.map(v => (v.user._id));
    const result = compareApproverDiff(oldUserIds, newUserIds);

    // If approverGroup already exists in DB
    if (approverGroup._id != null) {
      createRequestDataForUpdate(approverGroup._id, approverGroup.uuidForRenderList, approverGroup.approvalType, result.userIdToAdd, result.userIdToRemove);
    }

    updateApproverGroupHandler(groupIndex, approverGroup);
  }, [createRequestDataForUpdate, editingApproverGroups, updateApproverGroupHandler]);

  const onRemoveApproverGroupsHandler = useCallback((groupIndex: number) => {
    const targetEditingApproverGroup = editingApproverGroups[groupIndex];
    const clonedUpdateApproverGroupData = [...updateApproverGroupData];
    const targetUpdateApproverGroupData = clonedUpdateApproverGroupData.find(v => v.groupId === targetEditingApproverGroup._id);

    if (targetUpdateApproverGroupData != null && targetEditingApproverGroup._id != null) {
      targetUpdateApproverGroupData.shouldRemove = true;
      setUpdateApproverGroupData(clonedUpdateApproverGroupData);
    }
    else if (targetUpdateApproverGroupData == null && targetEditingApproverGroup._id != null) {
      setUpdateApproverGroupData([...clonedUpdateApproverGroupData, { groupId: targetEditingApproverGroup._id, shouldRemove: true }]);
    }

    removeApproverGroupHandler(groupIndex);
  }, [editingApproverGroups, removeApproverGroupHandler, updateApproverGroupData]);

  const clickSaveWorkflowButtonClickHandler = useCallback(async() => {
    const createApproverGroupData = createRequestDataForCreate(editingApproverGroups);

    try {
      const updateData = {
        name: editingWorkflowName,
        comment: editingWorkflowDescription,
        createApproverGroupData,
        updateApproverGroupData,
      };
      await updateWorkflow(updateData);

      onUpdated?.();
    }
    catch (err) {
      // TODO: Consider how to display errors
    }
  }, [createRequestDataForCreate, editingApproverGroups, editingWorkflowDescription, editingWorkflowName, onUpdated, updateApproverGroupData, updateWorkflow]);


  return (
    <>
      <WorkflowModalHeader onClickPageBackButton={onClickWorkflowDetailPageBackButton}>
        <span className="fw-bold">{t('approval_workflow.edit_workflow')} </span>
      </WorkflowModalHeader>

      <ModalBody>
        <div className="col-9 mx-auto">
          <WorkflowForm
            editingWorkflowName={editingWorkflowName}
            workflowNameChangeHandler={workflowNameChangeHandler}
            editingWorkflowDescription={editingWorkflowDescription}
            workflowDescriptionChangeHandler={workflowDescriptionChangeHandler}
          />
          <div className="position-relative">
            <EditableApproverGroupCards
              editingApproverGroups={editingApproverGroups}
              approvedApproverIds={allApprovedApproverIds}
              excludedSearchUserIds={excludedSearchUserIds}
              latestApprovedApproverGroupIndex={latestApprovedApproverGroupIndex ?? undefined}
              onUpdateApproverGroups={onUpdateApproverGroupsHandler}
              onClickAddApproverGroupCard={addApproverGroupHandler}
              onClickRemoveApproverGroupCard={onRemoveApproverGroupsHandler}
            />
            <div className="position-absolute top-0 start-0 bottom-0 end-0 m-auto bg-secondary z-0" style={{ width: '2px' }}></div>
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <div className="mx-auto">
          <button
            className="btn btn-secondary me-2"
            type="button"
            onClick={onClickWorkflowDetailPageBackButton}
          >{t('approval_workflow.cancel')}
          </button>
          <button
            className="btn btn-primary ms-2"
            type="button"
            onClick={clickSaveWorkflowButtonClickHandler}
          >{t('approval_workflow.completion')}
          </button>
        </div>
      </ModalFooter>
    </>
  );
};
