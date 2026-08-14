import SequenceDetail from '@/components/SequenceDetail'

export default async function SequenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <SequenceDetail id={Number(id)} />
}
