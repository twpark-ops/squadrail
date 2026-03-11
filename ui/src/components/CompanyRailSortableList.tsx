import { useCallback } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Company } from "@squadrail/shared";
import { CompanyRailItem } from "./CompanyRailItem";

interface CompanyRailSortableListProps {
  companies: Company[];
  selectedCompanyId: string | null;
  hasLiveAgentsByCompanyId: Map<string, boolean>;
  hasUnreadInboxByCompanyId: Map<string, boolean>;
  onSelect: (companyId: string) => void;
  onOrderChange: (ids: string[]) => void;
}

function SortableCompany({
  company,
  isSelected,
  hasLiveAgents,
  hasUnreadInbox,
  onSelect,
}: {
  company: Company;
  isSelected: boolean;
  hasLiveAgents: boolean;
  hasUnreadInbox: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: company.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="overflow-visible"
    >
      <CompanyRailItem
        company={company}
        isSelected={isSelected}
        hasLiveAgents={hasLiveAgents}
        hasUnreadInbox={hasUnreadInbox}
        onSelect={onSelect}
        isDragging={isDragging}
      />
    </div>
  );
}

export function CompanyRailSortableList({
  companies,
  selectedCompanyId,
  hasLiveAgentsByCompanyId,
  hasUnreadInboxByCompanyId,
  onSelect,
  onOrderChange,
}: CompanyRailSortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const ids = companies.map((company) => company.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      onOrderChange(arrayMove(ids, oldIndex, newIndex));
    },
    [companies, onOrderChange]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={companies.map((company) => company.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col items-center gap-1.5">
          {companies.map((company) => (
            <SortableCompany
              key={company.id}
              company={company}
              isSelected={company.id === selectedCompanyId}
              hasLiveAgents={hasLiveAgentsByCompanyId.get(company.id) ?? false}
              hasUnreadInbox={
                hasUnreadInboxByCompanyId.get(company.id) ?? false
              }
              onSelect={() => onSelect(company.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
