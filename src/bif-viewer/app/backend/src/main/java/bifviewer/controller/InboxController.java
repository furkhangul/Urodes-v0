package bifviewer.controller;

import bifviewer.dto.AssignInboxItemRequest;
import bifviewer.dto.InboxItemResponse;
import bifviewer.service.InboxAssignmentService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/inbox")
public class InboxController {

    private final InboxAssignmentService inboxAssignmentService;

    public InboxController(InboxAssignmentService inboxAssignmentService) {
        this.inboxAssignmentService = inboxAssignmentService;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public List<InboxItemResponse> listInboxItems() {
        return inboxAssignmentService.listItems();
    }

    @DeleteMapping(value = "/{inboxItemId}", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> deleteItem(@PathVariable UUID inboxItemId) {
        inboxAssignmentService.deleteItem(inboxItemId);
        return Map.of("id", inboxItemId.toString(), "message", "Inbox item deleted");
    }

    @PostMapping(value = "/{inboxItemId}/assign", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public InboxItemResponse assign(
            @PathVariable UUID inboxItemId,
            @RequestBody AssignInboxItemRequest request
    ) {
        if (request.userId() != null && !request.userId().isBlank()) {
            return inboxAssignmentService.assignAndIngest(inboxItemId, UUID.fromString(request.userId()));
        }
        return inboxAssignmentService.assignAndIngestByKeycloakId(inboxItemId, request.keycloakId());
    }
}
