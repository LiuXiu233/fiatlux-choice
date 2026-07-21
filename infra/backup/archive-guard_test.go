package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type testMember struct {
	header tar.Header
	body   []byte
}

func writeTestArchive(t *testing.T, members []testMember) string {
	t.Helper()
	filename := filepath.Join(t.TempDir(), "payload.tar.gz")
	file, err := os.Create(filename)
	if err != nil {
		t.Fatal(err)
	}
	compressed := gzip.NewWriter(file)
	tape := tar.NewWriter(compressed)
	for _, member := range members {
		header := member.header
		if header.Mode == 0 {
			header.Mode = 0o600
		}
		if header.Typeflag == tar.TypeReg || header.Typeflag == tar.TypeRegA {
			header.Size = int64(len(member.body))
		}
		if err = tape.WriteHeader(&header); err != nil {
			t.Fatal(err)
		}
		if len(member.body) > 0 {
			if _, err = tape.Write(member.body); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err = tape.Close(); err != nil {
		t.Fatal(err)
	}
	if err = compressed.Close(); err != nil {
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
	return filename
}

func attemptExtraction(t *testing.T, members []testMember, limits archiveLimits) error {
	t.Helper()
	archivePath := writeTestArchive(t, members)
	archive, err := os.Open(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	destination := filepath.Join(t.TempDir(), "payload")
	if err = os.Mkdir(destination, 0o700); err != nil {
		t.Fatal(err)
	}
	_, err = extractArchive(archive, destination, limits)
	if err != nil {
		entries, readErr := os.ReadDir(destination)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if len(entries) != 0 {
			t.Fatalf("invalid archive created files before rejection: %v", entries)
		}
	}
	return err
}

func defaultTestLimits() archiveLimits {
	return archiveLimits{maxMembers: 100, maxExpandedSize: 1 << 20}
}

func TestExtractAndVerifyCompleteManifest(t *testing.T) {
	database := []byte("database")
	metadata := []byte(`{"formatVersion":"2","sourceId":"fiatlux-test","backupName":"test","database":"fiatlux","bucket":"fiatlux","createdAt":"2026-07-19T00:00:00Z","tools":{"backupRelease":"v9.8.7-test","postgres":"test","minioClient":"test"}}`)
	object := []byte("object")
	manifest := fmt.Sprintf(
		"%x  ./database.dump\n%x  ./metadata.json\n%x  ./objects/nested/item.bin\n",
		sha256.Sum256(database), sha256.Sum256(metadata), sha256.Sum256(object),
	)
	members := []testMember{
		{header: tar.Header{Name: "./", Typeflag: tar.TypeDir}},
		{header: tar.Header{Name: "./objects/", Typeflag: tar.TypeDir}},
		{header: tar.Header{Name: "./database.dump", Typeflag: tar.TypeReg}, body: database},
		{header: tar.Header{Name: "./metadata.json", Typeflag: tar.TypeReg}, body: metadata},
		{header: tar.Header{Name: "./objects/nested/item.bin", Typeflag: tar.TypeReg}, body: object},
		{header: tar.Header{Name: "./manifest.sha256", Typeflag: tar.TypeReg}, body: []byte(manifest)},
	}
	archivePath := writeTestArchive(t, members)
	archive, err := os.Open(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	destination := filepath.Join(t.TempDir(), "payload")
	if err = os.Mkdir(destination, 0o700); err != nil {
		t.Fatal(err)
	}
	summary, err := extractArchive(archive, destination, defaultTestLimits())
	if err != nil {
		t.Fatal(err)
	}
	if summary.members != uint64(len(members)) {
		t.Fatalf("unexpected member count: %d", summary.members)
	}
	if _, err = verifyManifest(destination, "manifest.sha256", 100); err != nil {
		t.Fatal(err)
	}
	mode, err := os.Stat(filepath.Join(destination, "database.dump"))
	if err != nil {
		t.Fatal(err)
	}
	if mode.Mode().Perm() != 0o600 {
		t.Fatalf("extracted mode is %o, expected 0600", mode.Mode().Perm())
	}
}

func TestRejectsUnsafePathsBeforeExtraction(t *testing.T) {
	paths := []string{
		"/absolute",
		"../escape",
		"a/../../escape",
		"a//b",
		"a/./b",
		"a\\b",
	}
	for _, name := range paths {
		t.Run(strings.ReplaceAll(name, "/", "_"), func(t *testing.T) {
			err := attemptExtraction(t, []testMember{{header: tar.Header{Name: name, Typeflag: tar.TypeReg}, body: []byte("x")}}, defaultTestLimits())
			if err == nil {
				t.Fatalf("unsafe path %q was accepted", name)
			}
		})
	}
}

func TestRejectsEveryNonFileMemberTypeAndLinkTarget(t *testing.T) {
	types := []byte{
		tar.TypeSymlink,
		tar.TypeLink,
		tar.TypeChar,
		tar.TypeBlock,
		tar.TypeFifo,
		tar.TypeGNUSparse,
	}
	for _, memberType := range types {
		t.Run(fmt.Sprintf("type-%d", memberType), func(t *testing.T) {
			header := tar.Header{Name: "unsafe", Typeflag: memberType, Linkname: "target"}
			err := attemptExtraction(t, []testMember{{header: header}}, defaultTestLimits())
			if err == nil {
				t.Fatalf("member type %d was accepted", memberType)
			}
		})
	}
	err := attemptExtraction(t, []testMember{{
		header: tar.Header{Name: "regular", Typeflag: tar.TypeReg, Linkname: "ignored-target"},
		body:   []byte("x"),
	}}, defaultTestLimits())
	if err == nil {
		t.Fatal("regular member with a link target was accepted")
	}
}

func TestRejectsDuplicateAndParentFileConflicts(t *testing.T) {
	tests := map[string][]testMember{
		"duplicate": {
			{header: tar.Header{Name: "a", Typeflag: tar.TypeReg}},
			{header: tar.Header{Name: "./a", Typeflag: tar.TypeReg}},
		},
		"file-parent": {
			{header: tar.Header{Name: "a", Typeflag: tar.TypeReg}},
			{header: tar.Header{Name: "a/b", Typeflag: tar.TypeReg}},
		},
		"file-after-child": {
			{header: tar.Header{Name: "a/b", Typeflag: tar.TypeReg}},
			{header: tar.Header{Name: "a", Typeflag: tar.TypeReg}},
		},
	}
	for name, members := range tests {
		t.Run(name, func(t *testing.T) {
			if err := attemptExtraction(t, members, defaultTestLimits()); err == nil {
				t.Fatal("conflicting archive paths were accepted")
			}
		})
	}
}

func TestRejectsMemberCountAndExpandedSizeBombs(t *testing.T) {
	members := []testMember{
		{header: tar.Header{Name: "a", Typeflag: tar.TypeReg}, body: []byte("12345")},
		{header: tar.Header{Name: "b", Typeflag: tar.TypeReg}, body: []byte("67890")},
	}
	if err := attemptExtraction(t, members, archiveLimits{maxMembers: 1, maxExpandedSize: 100}); err == nil {
		t.Fatal("member-count limit was not enforced")
	}
	if err := attemptExtraction(t, members, archiveLimits{maxMembers: 10, maxExpandedSize: 9}); err == nil {
		t.Fatal("expanded-size limit was not enforced")
	}
}

func TestRejectsDisabledOrAboveHardLimits(t *testing.T) {
	invalid := []archiveLimits{
		{maxMembers: 0, maxExpandedSize: 1},
		{maxMembers: hardMaxMembers + 1, maxExpandedSize: 1},
		{maxMembers: 1, maxExpandedSize: 0},
		{maxMembers: 1, maxExpandedSize: hardMaxExpandedSize + 1},
	}
	for _, limits := range invalid {
		if err := validateLimits(limits); err == nil {
			t.Fatalf("invalid limits were accepted: %+v", limits)
		}
	}
}

func TestManifestMustCoverExactlySafeRegularFiles(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "database.dump"), []byte("database"), 0o600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte("database"))
	manifestPath := filepath.Join(root, "manifest.sha256")

	malicious := []string{
		fmt.Sprintf("%x  /etc/passwd\n", digest),
		fmt.Sprintf("%x  ../outside\n", digest),
		fmt.Sprintf("%x  ./missing.dump\n", digest),
	}
	for _, contents := range malicious {
		if err := os.WriteFile(manifestPath, []byte(contents), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := verifyManifest(root, "manifest.sha256", 100); err == nil {
			t.Fatalf("unsafe or incomplete manifest was accepted: %q", contents)
		}
	}

	valid := fmt.Sprintf("%x  ./database.dump\n", digest)
	if err := os.WriteFile(manifestPath, []byte(valid), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := verifyManifest(root, "manifest.sha256", 100); err != nil {
		t.Fatal(err)
	}
}

func TestRejectsManifestEntryAndTotalByteBombs(t *testing.T) {
	root := t.TempDir()
	first := []byte("first")
	second := []byte("second")
	if err := os.WriteFile(filepath.Join(root, "first.bin"), first, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "second.bin"), second, 0o600); err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(root, "manifest.sha256")
	manifest := fmt.Sprintf("%x  ./first.bin\n%x  ./second.bin\n", sha256.Sum256(first), sha256.Sum256(second))
	if err := os.WriteFile(manifestPath, []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := verifyManifest(root, "manifest.sha256", 1); err == nil || !strings.Contains(err.Error(), "entry limit") {
		t.Fatalf("manifest entry bomb was not rejected with the expected reason: %v", err)
	}

	limit, err := manifestSizeLimit(1)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Truncate(manifestPath, int64(limit+1)); err != nil {
		t.Fatal(err)
	}
	if _, err = verifyManifest(root, "manifest.sha256", 1); err == nil || !strings.Contains(err.Error(), "byte limit") {
		t.Fatalf("manifest byte bomb was not rejected with the expected reason: %v", err)
	}
}

func TestManifestLimitsHaveFiniteHardCap(t *testing.T) {
	limit, err := manifestSizeLimit(hardMaxMembers)
	if err != nil {
		t.Fatal(err)
	}
	if limit != hardMaxManifestSize {
		t.Fatalf("unexpected hard manifest byte limit: %d", limit)
	}
	for _, entries := range []uint64{0, hardMaxMembers + 1} {
		if _, err = manifestSizeLimit(entries); err == nil {
			t.Fatalf("invalid manifest entry limit %d was accepted", entries)
		}
	}
}

func TestRejectsNonZeroDataAfterTarEnd(t *testing.T) {
	var inner bytes.Buffer
	compressed := gzip.NewWriter(&inner)
	tape := tar.NewWriter(compressed)
	if err := tape.WriteHeader(&tar.Header{Name: "safe", Typeflag: tar.TypeReg, Mode: 0o600, Size: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := tape.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	if err := tape.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := compressed.Write([]byte("hidden")); err != nil {
		t.Fatal(err)
	}
	if err := compressed.Close(); err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(t.TempDir(), "trailing.tar.gz")
	if err := os.WriteFile(filename, inner.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	archive, err := os.Open(filename)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	destination := filepath.Join(t.TempDir(), "payload")
	if err = os.Mkdir(destination, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err = extractArchive(archive, destination, defaultTestLimits()); err == nil {
		t.Fatal("non-zero data after the tar end marker was accepted")
	}
}
