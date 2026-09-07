export const STORAGE_REFERENCES = Symbol('STORAGE_REFERENCES');

export interface StorageReference {
	id: string;
	ownerUserId: string;
	recipientUserId: string;
	objectKey: string;
	name: string;
	createdAt: Date;
}

export interface StorageReferenceStore {
	create(
		recipientUserId: string,
		ownerUserId: string,
		objectKey: string,
		name: string
	): Promise<StorageReference>;
	list(recipientUserId: string): Promise<StorageReference[]>;
	getForUser(recipientUserId: string, id: string): Promise<StorageReference | null>;
	revoke(recipientUserId: string, id: string): Promise<void>;
	revokeForObject(ownerUserId: string, objectKey: string): Promise<void>;
}
