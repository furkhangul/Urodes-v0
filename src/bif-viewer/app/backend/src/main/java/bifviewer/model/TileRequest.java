package bifviewer.model;

public record TileRequest(String slideId, int z, int x, int y) {

    public boolean isValid() {
        return slideId != null
                && !slideId.isBlank()
                && z >= 0
                && x >= 0
                && y >= 0;
    }
}
