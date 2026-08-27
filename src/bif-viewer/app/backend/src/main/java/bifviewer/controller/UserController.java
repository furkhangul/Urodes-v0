package bifviewer.controller;

import bifviewer.dto.AppUserResponse;
import bifviewer.service.AppUserService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api")
public class UserController {

    private final AppUserService appUserService;

    public UserController(AppUserService appUserService) {
        this.appUserService = appUserService;
    }

    @GetMapping(value = "/me", produces = MediaType.APPLICATION_JSON_VALUE)
    public AppUserResponse me() {
        return appUserService.toResponse(appUserService.currentUser());
    }

    @GetMapping(value = "/users", produces = MediaType.APPLICATION_JSON_VALUE)
    public List<AppUserResponse> users() {
        return appUserService.listUsers();
    }

    @GetMapping(value = "/users/viewers", produces = MediaType.APPLICATION_JSON_VALUE)
    public List<AppUserResponse> viewers() {
        return appUserService.listViewers();
    }
}
